'use strict';

const _ = require('lodash');
const os = require('os');
const path = require('path');
const fs = require('fs');

const {
  getBranch,
  getClosestApp,
  getComposerPackages,
  getEnvFileKeys,
  loadModel,
} = require('../lib/workspace');
const {getSupportedVersions, getVersionTableStatus, VERSIONED_PLUGINS} = require('../lib/mapping/versions');
const {getRuntimeEnv} = require('../lib/env');
const {mapApplication, mapService} = require('../lib/mapping/index');
const {getDatabaseHost, getDatabaseInit, REPLICA_TYPES} = require('../lib/mapping/database');
const {getMailpitDefinition} = require('../lib/mapping/services');
const {getLifecycleWarning} = require('../lib/mapping/registry');
const {getProxyConfig} = require('../lib/routes');
const {resolveCli, getCliEnv, getInstallStep} = require('../lib/cli');
const {getPullTask} = require('../lib/pull');
const {getPushTask} = require('../lib/push');
const {getSwitchTask} = require('../lib/switch');
const {getAuthOptions} = require('../lib/auth');
const login = require('../lib/login');
const {readLocalProjectId} = require('../lib/project');
const {getStartCommands} = require('../lib/hooks');
const tokens = require('../lib/tokens');
const tooling = require('../lib/tooling');
const router = require('../lib/tooling-router');
const {unique} = require('../lib/warnings');

// Rendered config (nginx vhost, php.ini) is written to files rather than passed inline: Lando embeds inline
// service config in LANDO_INFO, where nginx `$` variables trip docker compose interpolation.
const CONFIG_FILES = {vhosts: 'vhost.conf', php: 'php.ini'};
const writeConfigFiles = (dir, service, config) => {
  const root = path.resolve(dir);
  const namePath = path.resolve(root, service);
  if (!/^[A-Za-z0-9_.-]+$/.test(service) || !namePath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Invalid Upsun service name for generated config: ${service}`);
  }
  fs.mkdirSync(dir, {recursive: true});
  return Object.fromEntries(Object.entries(config).map(([key, value]) => {
    if (typeof value !== 'string' || !value.includes('\n') || !CONFIG_FILES[key]) return [key, value];
    const file = path.resolve(root, `${service}-${CONFIG_FILES[key]}`);
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error(`Generated config path escapes ${root}: ${service}`);
    fs.writeFileSync(file, value);
    return [key, file];
  }));
};

module.exports = {
  name: 'upsun',
  parent: '_recipe',
  config: {
    proxy: {}, services: {}, tooling: {},
    build: [], run: [], mail: true, crons: false,
  },
  builder: (parent, config) => class LandoUpsun extends parent {
    constructor(id, options = {}) {
      // Keep the real app object; _.merge would clone it and lose our shared state
      const app = options._app;
      options = _.merge({}, config, _.omit(options, ['_app']), {_app: app});
      const root = options.root;
      const landoDir = path.dirname(path.join(root,
        _.get(app, '_config.landoFile') ? app._config.landoFile : '.lando.yml'));
      const landoConfig = _.get(app, 'config.config', {});

      const model = loadModel(root, {
        overrides: _.isPlainObject(landoConfig.overrides) ? landoConfig.overrides : {},
        variables: _.isPlainObject(landoConfig.variables) ? landoConfig.variables : {},
      });
      const flavor = model.flavor;
      const cli = resolveCli(flavor);
      const closestApp = getClosestApp(model, root, landoDir, landoConfig.app);
      const branch = _.get(app, 'upsun.branch') || getBranch(root);
      const projectId = landoConfig.id || readLocalProjectId(root, flavor) || 'lando';
      const domain = _.get(app, '_config.domain', 'lndo.site');
      const domains = landoConfig.domains === undefined ? [] : landoConfig.domains;
      if (!Array.isArray(domains) || domains.some(value => typeof value !== 'string')) {
        throw new Error('config.domains must be an array of strings');
      }
      const name = app.name;
      const omitVariables = getEnvFileKeys(app.envFiles);
      const mail = landoConfig.mail !== false && !model.services.mailpit;
      const crons = landoConfig.crons === true;
      const plugins = _.get(app, '_lando.config.plugins', []);
      const versions = getSupportedVersions(plugins);
      const configDir = path.join(_.get(app, '_config.userConfRoot', os.tmpdir()), 'config', 'upsun', app.project);
      const warnings = [...model.warnings];
      /** @type {Record<string, import('../lib/mapping/mapping.types').HostMapEntry>} */
      const hostMap = {};
      /** @type {import('../lib/mapping/mapping.types').MappedServices} */
      const services = {};
      const databases = [];

      // Services first so hostMap is complete before env generation
      const replicaDatabases = [];
      for (const service of Object.values(model.services)) {
        const mapped = mapService(service, model, {versions});
        Object.assign(services, mapped.services);
        Object.assign(hostMap, mapped.hostMap);
        warnings.push(...mapped.warnings);
        if (!REPLICA_TYPES[service.type.service]) {
          const warning = getLifecycleWarning({kind: 'service', name: service.name,
            type: service.type.service, version: service.type.version});
          if (warning) warnings.push(warning);
        }
        const init = getDatabaseInit(service, model);
        const target = getDatabaseHost(service, model);
        if (init && target) {
          const list = REPLICA_TYPES[service.type.service] ? replicaDatabases : databases;
          list.push({service: service.name, host: target.host, ...init});
        }
      }
      databases.push(...replicaDatabases);

      /** @type {Record<string, import('../lib/mapping/mapping.types').ProxyTarget>} */
      const targets = {};
      for (const [serviceName, entry] of Object.entries(hostMap)) {
        if (entry.scheme === 'http' && services[entry.host]) {
          targets[serviceName] = {service: entry.host, port: entry.port};
        }
      }
      const startCommands = {};
      const mailFrom = [];
      const cachedTokens = tokens.readTokens(app._lando, cli.vendor);
      const meta = app._lando.cache.get(`${app.name}.meta.cache`) || {};
      const saved = cachedTokens.find(entry => entry.token === meta.token);
      const account = saved ? {token: saved.token, email: meta.email || saved.email} : {};
      const token = (saved || cachedTokens[0])?.token;
      const cliEnv = getCliEnv(flavor, {token, projectId, environment: branch});
      const appEntries = Object.entries(model.applications);
      const orderedApps = [appEntries.find(([appName]) => appName === closestApp),
        ...appEntries.filter(([appName]) => appName !== closestApp)];
      // Map once and collect every HTTP target before resolving cross-application relationships.
      const mappedApps = new Map(orderedApps.map(([appName, modelApp]) => {
        const mapped = mapApplication(modelApp, model, {xdebug: options.xdebug, mail, crons, versions});
        warnings.push(...mapped.warnings);
        if (!modelApp.composable) {
          const warning = getLifecycleWarning({kind: 'application', name: appName,
            type: modelApp.type.runtime, version: modelApp.type.version});
          if (warning) warnings.push(warning);
        }
        const target = Object.values(mapped.services).find(definition => definition.upsun.role === 'app')?.upsun.proxy;
        if (target) {
          targets[appName] = target;
          hostMap[appName] = {host: target.service, port: target.port, scheme: 'http'};
        }
        return [appName, mapped];
      }));
      for (const [appName, modelApp] of orderedApps) {
        const mapped = mappedApps.get(appName);
        for (const [rel, {service, endpoint}] of Object.entries(modelApp.relationships)) {
          if (hostMap[`${service}#${endpoint}`] ?? hostMap[service]) continue;
          warnings.push({
            code: 'relationship-unresolved',
            message: `Relationship ${rel} of ${appName} points at ${service}, ` +
              'which has no local service; it was skipped.',
          });
        }
        for (const [serviceName, definition] of Object.entries(mapped.services)) {
          const role = definition.upsun.role;
          /** @type {import('../lib/mapping/mapping.types').AssembledService} */
          const def = _.omit(definition, ['upsun', 'build', 'build_as_root']);
          if (def.config) def.config = writeConfigFiles(configDir, serviceName, def.config);
          if (role === 'nginx') {
            services[serviceName] = def;
            continue;
          }
          const env = getRuntimeEnv(model, appName, {
            domain, domains, name, projectId, branch, hostMap, omitVariables,
            smtpHost: mail ? 'mailpit' : '', relationships: definition.upsun.relationships,
          });
          def.overrides = _.merge({}, def.overrides, {
            environment: {...env, ...(definition.overrides?.environment || {})},
          });
          const install = role === 'app' || role === 'worker' ? [getInstallStep(flavor)] : [];
          def.build_as_root_internal = [...definition.build_as_root, ...install];
          def.build_internal = [...definition.build];
          if (serviceName === closestApp) {
            def.build_internal.push(...options.build);
            if (options.run.length) def.run_internal = [...options.run];
          }
          const commands = getStartCommands(model, appName, {
            role,
            worker: definition.upsun.worker,
            databases: serviceName === closestApp ? databases : [],
          });
          if (role === 'app' && modelApp.type.runtime !== 'php' &&
            commands.some(command => command.name.startsWith('db-init:'))) {
            def.overrides.environment.UPSUN_PROVISION_WAIT = '300';
          }
          if (commands.length) startCommands[serviceName] = commands;
          mailFrom.push(serviceName);
          services[serviceName] = def;
        }
      }

      const neededTypes = new Set(Object.values(services)
          .map(def => String(def.type).split(':')[0]).filter(type => VERSIONED_PLUGINS.has(type)));
      warnings.push(...getVersionTableStatus(plugins, neededTypes, versions));

      let mailProxy = {};
      if (mail) {
        const mailpit = getMailpitDefinition({mailFrom, host: `${name}.${domain}`});
        services.mailpit = mailpit.services.mailpit;
        mailProxy = mailpit.proxy;
      }

      const proxied = getProxyConfig(model, {domain, domains, name}, targets);
      warnings.push(...proxied.warnings);
      const proxy = _.merge({}, proxied.proxy, mailProxy);

      const closestDef = services[closestApp];
      const closestType = closestDef ? String(closestDef.type).split(':')[0] : undefined;
      const cliRef = {...cli, projectId, environment: branch};
      const browserLogin = () => login.promptBrowserLogin({lando: app._lando, vendor: cli.vendor});
      const userTooling = _.merge({}, options.tooling, _.get(app, 'config.tooling', {}));
      const buildAppTooling = appName => {
        const modelApp = model.applications[appName];
        const def = services[appName];
        if (!modelApp || !def) return null;
        const type = String(def.type).split(':')[0];
        const dir = path.posix.join('/app', modelApp.sourceRoot);
        return {
          ...tooling.getLanguageTooling(appName, type, {dir}),
          ...tooling.getComposerTooling(appName, dir, getComposerPackages(path.join(root, modelApp.sourceRoot)), {dir}),
          ...tooling.getRelationshipTooling(modelApp, services, hostMap),
          ...tooling.getDatabaseTooling(appName, model, services),
          ...tooling.getCronTooling(appName, modelApp),
          ...tooling.getOperationTooling(appName, modelApp),
          ...(type === 'php' ? tooling.getXdebugTooling(appName) : {}),
          [cli.binary]: {
            service: appName,
            description: `Runs the ${cli.binary} CLI against your Upsun project`,
            cmd: tooling.withEnv(cli.binary),
            dir,
            env: cliEnv,
          },
          ...(model.layout === 'magento' ? tooling.getMagentoTooling(appName) : {
            'auth upsun': {
              service: appName,
              description: 'Log in to Upsun and save an API token for this app',
              cmd: [],
              level: 'app',
              options: getAuthOptions({}, cachedTokens, browserLogin),
              // Core parses argv twice and the first parse consumes the positional, so it needs a default
              positionals: {upsun: {describe: 'Account provider', choices: ['upsun'], default: 'upsun'}},
            },
            'pull': getPullTask(model, appName, cliRef, cachedTokens, browserLogin, account),
            'push': getPushTask(model, appName, cliRef, cachedTokens, browserLogin, account),
            // Optional so the early yargs parse does not demand the environment before the picker runs
            'switch [environment]': {
              ...getSwitchTask(model, appName, cliRef, cachedTokens, browserLogin, account),
              positionals: {environment: {type: 'string', describe: 'Upsun environment to check out'}},
            },
          }),
        };
      };
      const generated = new Map(Object.keys(model.applications).flatMap(appName => {
        const commands = buildAppTooling(appName);
        return commands ? [[appName, commands]] : [];
      }));
      const baseKeys = Object.keys(generated.get(closestApp) || {});
      const userKeys = Object.keys(userTooling);
      const masked = appName => {
        const commands = generated.get(appName) || {};
        return router.routeTooling(commands, baseKeys, userKeys);
      };
      const toolingRouter = router.withRootFallback([...generated.keys()].map(appName => ({
        route: path.resolve(root, model.applications[appName].sourceRoot || ''),
        tooling: appName === closestApp ? {} : masked(appName),
      })), root, [path.resolve(root, model.applications[closestApp].sourceRoot || '')]);

      // Closest app first: Lando's default service (lando ssh, tooling) is the first v3 service.
      // An unsupported runtime maps to no service (only a warning), so there is nothing to put first.
      const ordered = services[closestApp] ? {[closestApp]: services[closestApp], ...services} : services;
      options.services = _.merge({}, ordered, options.services);
      options.proxy = _.merge({}, proxy, options.proxy);
      options.tooling = _.merge({}, generated.get(closestApp) || {}, options.tooling);

      app.upsun = {
        model, flavor, cli, closestApp, closestType, hostMap, branch, projectId, mail,
        startCommands, toolingRouter, warnings: unique(warnings),
      };

      super(id, options);
    }
  },
};
