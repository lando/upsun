'use strict';

const _ = require('lodash');
const os = require('os');
const path = require('path');
const fs = require('fs');
const {execSync} = require('child_process');

const {load} = require('../lib/config/index');
const {getRuntimeEnv} = require('../lib/env');
const {mapApplication, mapService} = require('../lib/mapping/index');
const {getDatabaseInit} = require('../lib/mapping/database');
const {getMailpitDefinition} = require('../lib/mapping/services');
const {getProxyConfig} = require('../lib/routes');
const {resolveCli, getCliEnv, getInstallStep} = require('../lib/cli');
const {getPullTask} = require('../lib/pull');
const {getPushTask} = require('../lib/push');
const {readLocalProjectId} = require('../lib/project');
const {getStartCommands} = require('../lib/hooks');
const tokens = require('../lib/tokens');
const tooling = require('../lib/tooling');
const {unique} = require('../lib/warnings');

const DOCS = 'https://docs.lando.dev/upsun/config.html';
const VERSIONED_PLUGINS = new Set([
  'php', 'node', 'python', 'ruby', 'go', 'mariadb', 'mysql', 'postgres', 'redis', 'memcached', 'mongo', 'solr',
  'elasticsearch', 'varnish']);

/**
 * Current git branch of the project, falling back to `main`.
 * @param {string} root Project root.
 * @returns {string} Branch name.
 */
const getBranch = root => {
  try {
    return execSync('git symbolic-ref --short HEAD', {cwd: root, stdio: ['ignore', 'pipe', 'ignore']})
        .toString().trim() || 'main';
  } catch {
    return 'main';
  }
};

/**
 * Pick the model application the Landofile belongs to.
 * @param {object} model Normalized model.
 * @param {string} root Project root.
 * @param {string} landoDir Directory containing the Landofile.
 * @param {string} [explicit] App name from `config.app`.
 * @returns {string} App name.
 */
const getClosestApp = (model, root, landoDir, explicit) => {
  const names = Object.keys(model.applications);
  if (explicit) {
    if (!names.includes(explicit)) throw new Error(`config.app "${explicit}" is not one of: ${names.join(', ')}`);
    return explicit;
  }
  if (names.length === 1) return names[0];
  const rel = path.relative(root, landoDir).split(path.sep).join('/');
  return _(names)
      .filter(name => {
        const src = model.applications[name].sourceRoot;
        return src === '' || rel === src || rel.startsWith(`${src}/`);
      })
      .maxBy(name => model.applications[name].sourceRoot.length) || names[0];
};

// Package names an app's composer project pulls in (root requires + lockfile), for framework tooling
const readJson = file => {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const getComposerPackages = dir => {
  const json = readJson(path.join(dir, 'composer.json'));
  const lock = readJson(path.join(dir, 'composer.lock'));
  return new Set([
    ...Object.keys(json?.require || {}),
    ...Object.keys(json?.['require-dev'] || {}),
    ...(lock?.packages || []).map(pkg => pkg.name),
    ...(lock?.['packages-dev'] || []).map(pkg => pkg.name),
  ]);
};

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

const loadModel = root => {
  try {
    return load(root);
  } catch (error) {
    if (error.code === 'UPSUN_NO_CONFIG') {
      throw new Error(`No Upsun configuration found in ${root}. Expected .upsun/config.yaml (Flex) ` +
        `or .platform.app.yaml + .platform/ (Fixed). See ${DOCS}`);
    }
    if (error.code === 'UPSUN_MIXED_CONFIG') {
      throw new Error(`Both .upsun/ and .platform/ configuration found in ${root}; Upsun projects use one or ` +
        `the other. See ${DOCS}`);
    }
    throw error;
  }
};

/**
 * Read supported versions from installed Lando service plugins.
 * @param {Array<{name: string, dir: string}>} plugins Installed plugin metadata.
 * @returns {object} Supported versions keyed by Lando service type.
 */
const getSupportedVersions = (plugins = []) => {
  const versions = {};
  for (const plugin of plugins) {
    const match = /^@lando\/(.+)$/.exec(plugin.name || '');
    const type = match?.[1];
    if (!VERSIONED_PLUGINS.has(type)) continue;
    try {
      const builder = require(path.join(plugin.dir, 'builders', `${type}.js`));
      if (Array.isArray(builder?.config?.supported)) {
        versions[type] = [...new Set([...builder.config.supported, ...(builder.config.legacy || [])])];
      }
    } catch (error) {
      void error;
    }
  }
  return versions;
};

/*
 * The upsun recipe: translate Upsun configuration into Lando services, proxy and tooling.
 */
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
      const landoDir = path.dirname(_.get(app, '_config.landoFile') ?
        path.join(root, app._config.landoFile) : path.join(root, '.lando.yml'));
      const landoConfig = _.get(app, 'config.config', {});

      const model = loadModel(root);
      const flavor = model.flavor;
      const cli = resolveCli(flavor);
      const closestApp = getClosestApp(model, root, landoDir, landoConfig.app);
      const branch = _.get(app, 'upsun.branch') || getBranch(root);
      const projectId = landoConfig.id || readLocalProjectId(root, flavor) || 'lando';
      const domain = _.get(app, '_config.domain', 'lndo.site');
      const name = app.name;
      const tethered = landoConfig.tethered === true || typeof landoConfig.tethered === 'string';
      const tetherEnvironment = typeof landoConfig.tethered === 'string' ? landoConfig.tethered : branch;
      const mail = landoConfig.mail !== false && !model.services.mailpit;
      const crons = landoConfig.crons === true;
      const versions = getSupportedVersions(_.get(app, '_lando.config.plugins', []));
      const configDir = path.join(_.get(app, '_config.userConfRoot', os.tmpdir()), 'config', 'upsun', app.project);
      const warnings = [...model.warnings];
      const hostMap = {};
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

      const targets = {};
      const startCommands = {};
      const mailFrom = [];
      const cachedTokens = tokens.readTokens(app._lando, cli.vendor);
      const token = cachedTokens.length ? cachedTokens[0].token : undefined;
      const cliEnv = getCliEnv(flavor, {token, projectId, environment: branch});
      const appEntries = Object.entries(model.applications);
      const orderedApps = [appEntries.find(([appName]) => appName === closestApp),
        ...appEntries.filter(([appName]) => appName !== closestApp)];
      for (const [appName, modelApp] of orderedApps) {
        const mapped = mapApplication(modelApp, model, {xdebug: options.xdebug, mail, crons, versions});
        warnings.push(...mapped.warnings);
        const env = getRuntimeEnv(model, appName, {
          domain, name, projectId, branch, hostMap, tethered, tetherEnvironment, smtpHost: mail ? 'mailpit' : '',
        });
        for (const [serviceName, definition] of Object.entries(mapped.services)) {
          const role = definition.upsun.role;
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
          if (role === 'app') targets[appName] = definition.upsun.proxy;
          const commands = getStartCommands(model, appName, {
            role,
            worker: definition.upsun.worker,
            databases: serviceName === closestApp ? databases : [],
            tethered,
            tetherEnv: {...cliEnv, UPSUN_CLI_BINARY: cli.binary, UPSUN_CLI_TOKEN_VAR: cli.tokenVar},
          });
          if (commands.length) startCommands[serviceName] = commands;
          mailFrom.push(serviceName);
          services[serviceName] = def;
        }
      }

      let mailProxy = {};
      if (mail) {
        const mailpit = getMailpitDefinition({mailFrom, host: `${name}.${domain}`});
        services.mailpit = mailpit.services.mailpit;
        mailProxy = mailpit.proxy;
      }

      const proxied = getProxyConfig(model, {domain, name}, targets);
      warnings.push(...proxied.warnings);
      const proxy = _.merge({}, proxied.proxy, mailProxy);

      // Tooling for the closest app
      const closest = model.applications[closestApp];
      const closestDef = services[closestApp];
      const closestType = closestDef ? String(closestDef.type).split(':')[0] : undefined;
      const dir = path.posix.join('/app', closest.sourceRoot);
      const cliRef = {...cli, projectId, environment: branch};
      const appTooling = closestDef ? {
        ...tooling.getLanguageTooling(closestApp, closestType, {dir}),
        ...tooling.getComposerTooling(closestApp, dir, getComposerPackages(path.join(root, closest.sourceRoot)), {dir}),
        ...tooling.getRelationshipTooling(closest, services, hostMap),
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
      } : {};

      // Closest app first: Lando's default service (lando ssh, tooling) is the first v3 service
      const ordered = {[closestApp]: services[closestApp], ...services};
      options.services = _.merge({}, ordered, options.overrides, options.services);
      options.proxy = _.merge({}, proxy, options.proxy);
      options.tooling = _.merge({}, appTooling, options.tooling);

      // Share with app.js / index.js
      app.upsun = {
        model, flavor, cli, closestApp, closestType, hostMap, branch, projectId, tethered, tetherEnvironment, mail,
        startCommands, warnings: unique(warnings),
      };

      super(id, options);
    }
  },
};
