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
const {getDatabaseInit} = require('../lib/mapping/database');
const {getMailpitDefinition} = require('../lib/mapping/services');
const {getProxyConfig} = require('../lib/routes');
const {resolveCli, getCliEnv, getInstallStep} = require('../lib/cli');
const {getPullTask} = require('../lib/pull');
const {getPushTask} = require('../lib/push');
const {getSwitchTask} = require('../lib/switch');
const {readLocalProjectId} = require('../lib/project');
const {getStartCommands} = require('../lib/hooks');
const tokens = require('../lib/tokens');
const tooling = require('../lib/tooling');
const {unique} = require('../lib/warnings');

// Rendered config (nginx vhost, php.ini) is written to files rather than passed inline: Lando embeds inline
// service config in LANDO_INFO, where nginx `$` variables trip docker compose interpolation.
const CONFIG_FILES = {vhosts: 'vhost.conf', php: 'php.ini'};
const writeConfigFiles = (dir, service, config) => {
  fs.mkdirSync(dir, {recursive: true});
  return Object.fromEntries(Object.entries(config).map(([key, value]) => {
    if (typeof value !== 'string' || !value.includes('\n') || !CONFIG_FILES[key]) return [key, value];
    const file = path.join(dir, `${service}-${CONFIG_FILES[key]}`);
    fs.writeFileSync(file, value);
    return [key, file];
  }));
};

module.exports = {
  name: 'upsun',
  parent: '_recipe',
  config: {
    proxy: {}, services: {}, tooling: {}, overrides: {},
    xdebug: false, build: [], run: [], mail: true, crons: false, tethered: false,
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

      const model = loadModel(root);
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
      const tethered = landoConfig.tethered === true || typeof landoConfig.tethered === 'string';
      const tetherEnvironment = typeof landoConfig.tethered === 'string' ? landoConfig.tethered : branch;
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
      if (!tethered) {
        for (const service of Object.values(model.services)) {
          const mapped = mapService(service, model, {versions});
          Object.assign(services, mapped.services);
          Object.assign(hostMap, mapped.hostMap);
          warnings.push(...mapped.warnings);
          const init = getDatabaseInit(service);
          if (init) databases.push({service: service.name, host: service.name, ...init});
        }
      }

      /** @type {Record<string, import('../lib/mapping/mapping.types').ProxyTarget>} */
      const targets = {};
      const startCommands = {};
      const mailFrom = [];
      const cachedTokens = tokens.readTokens(app._lando, cli.vendor);
      const token = cachedTokens.length ? cachedTokens[0].token : undefined;
      const cliEnv = getCliEnv(flavor, {token, projectId, environment: branch});
      const appEntries = Object.entries(model.applications);
      const orderedApps = [appEntries.find(([appName]) => appName === closestApp),
        ...appEntries.filter(([appName]) => appName !== closestApp)];
      // Map once and collect every HTTP target before resolving cross-application relationships.
      const mappedApps = new Map(orderedApps.map(([appName, modelApp]) => {
        const mapped = mapApplication(modelApp, model, {xdebug: options.xdebug, mail, crons, versions});
        warnings.push(...mapped.warnings);
        const target = Object.values(mapped.services).find(definition => definition.upsun.role === 'app')?.upsun.proxy;
        if (target) {
          targets[appName] = target;
          hostMap[appName] = {host: target.service, port: target.port, scheme: 'http'};
        }
        return [appName, mapped];
      }));
      for (const [appName, modelApp] of orderedApps) {
        const mapped = mappedApps.get(appName);
        if (!tethered) {
          for (const [rel, {service, endpoint}] of Object.entries(modelApp.relationships)) {
            if (hostMap[`${service}#${endpoint}`] ?? hostMap[service]) continue;
            warnings.push({
              code: 'relationship-unresolved',
              message: `Relationship ${rel} of ${appName} points at ${service}, ` +
                'which has no local service; it was skipped.',
            });
          }
        }
        const env = getRuntimeEnv(model, appName, {
          domain, domains, name, projectId, branch, hostMap, tethered, tetherEnvironment, omitVariables,
          smtpHost: mail ? 'mailpit' : '',
        });
        for (const [serviceName, definition] of Object.entries(mapped.services)) {
          const role = definition.upsun.role;
          /** @type {import('../lib/mapping/mapping.types').AssembledService} */
          const def = _.omit(definition, ['upsun', 'build', 'build_as_root']);
          if (def.config) def.config = writeConfigFiles(configDir, serviceName, def.config);
          if (role === 'nginx') {
            services[serviceName] = def;
            continue;
          }
          // Tunnels are opened in the app container only; sidecars must not wait for them
          const serviceEnv = role === 'app' ? env : _.omit(env, ['UPSUN_TETHERED']);
          def.overrides = _.merge({}, def.overrides, {
            environment: {...serviceEnv, ...(definition.overrides?.environment || {})},
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
            tethered,
            tetherEnv: {...cliEnv, UPSUN_CLI_BINARY: cli.binary, UPSUN_CLI_TOKEN_VAR: cli.tokenVar},
          });
          if (!tethered && role === 'app' && modelApp.type.runtime !== 'php' &&
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

      const closest = model.applications[closestApp];
      const closestDef = services[closestApp];
      const closestType = closestDef ? String(closestDef.type).split(':')[0] : undefined;
      const dir = path.posix.join('/app', closest.sourceRoot);
      const cliRef = {...cli, projectId, environment: branch};
      const appTooling = closestDef ? {
        ...tooling.getLanguageTooling(closestApp, closestType, {dir}),
        ...tooling.getComposerTooling(closestApp, dir, getComposerPackages(path.join(root, closest.sourceRoot)), {dir}),
        ...tooling.getRelationshipTooling(closest, services, hostMap),
        ...(!tethered ? tooling.getDatabaseTooling(closestApp, model, services) : {}),
        ...tooling.getCronTooling(closestApp, closest),
        ...tooling.getOperationTooling(closestApp, closest),
        ...(closestType === 'php' ? tooling.getXdebugTooling(closestApp) : {}),
        ...(tethered ? tooling.getTetherTooling(closestApp, cliEnv) : {}),
        [cli.binary]: {
          service: closestApp,
          description: `Runs the ${cli.binary} CLI against your Upsun project`,
          cmd: tooling.withEnv(cli.binary),
          dir,
          env: cliEnv,
        },
        pull: getPullTask(model, closestApp, cliRef, cachedTokens),
        push: getPushTask(model, closestApp, cliRef, cachedTokens),
        ...(model.layout !== 'magento' ? {
          'switch <environment>': getSwitchTask(model, closestApp, cliRef, cachedTokens),
        } : {}),
        ...(model.layout === 'magento' ? tooling.getMagentoTooling(closestApp) : {}),
      } : {};

      // Closest app first: Lando's default service (lando ssh, tooling) is the first v3 service.
      // An unsupported runtime maps to no service (only a warning), so there is nothing to put first.
      const ordered = services[closestApp] ? {[closestApp]: services[closestApp], ...services} : services;
      options.services = _.merge({}, ordered, options.overrides, options.services);
      options.proxy = _.merge({}, proxy, options.proxy);
      options.tooling = _.merge({}, appTooling, options.tooling);

      app.upsun = {
        model, flavor, cli, closestApp, closestType, hostMap, branch, projectId, tethered, tetherEnvironment, mail,
        startCommands, warnings: unique(warnings),
      };

      super(id, options);
    }
  },
};
