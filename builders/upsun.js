'use strict';

const _ = require('lodash');
const path = require('path');
const fs = require('fs');
const {execSync} = require('child_process');

const {load} = require('../lib/config/index');
const {getRuntimeEnv} = require('../lib/env');
const {mapApplication, mapService} = require('../lib/mapping/index');
const {getProxyConfig} = require('../lib/routes');
const {renderVhost} = require('../lib/nginx');
const {resolveCli, getCliEnv, getInstallStep} = require('../lib/cli');
const {getPullTask, getPullBuildSteps} = require('../lib/pull');
const {getPushTask} = require('../lib/push');
const tokens = require('../lib/tokens');
const tooling = require('../lib/tooling');
const {unique} = require('../lib/warnings');

const DOCS = 'https://docs.lando.dev/upsun/config.html';

/**
 * Current git branch of the project, falling back to `main`.
 *
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
 *
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

// Lando service + port that fronts an app (php via nginx uses a sidecar)
const getProxyTarget = (name, definition) => {
  const type = String(definition.type).split(':')[0];
  if (type === 'php') {
    return _.startsWith(definition.via, 'nginx') ?
      {service: `${name}_nginx`, port: 80} : {service: name, port: 80};
  }
  return {service: name, port: definition.port || 8888};
};

// Mounts live inside /app (which is a host bind mount) so they only need to exist
const getMountSteps = (app, sourceRoot) => {
  const dirs = Object.keys(app.mounts || {}).map(mount => path.posix.join('/app', sourceRoot, mount));
  return dirs.length ? [`mkdir -p ${dirs.map(dir => `"${dir}"`).join(' ')}`] : [];
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

/*
 * The upsun recipe: translate Upsun configuration into Lando services, proxy and tooling.
 */
module.exports = {
  name: 'upsun',
  parent: '_recipe',
  config: {
    proxy: {},
    services: {},
    tooling: {},
    xdebug: false,
    build: [],
    run: [],
    overrides: {},
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
      const projectId = landoConfig.id || 'lando';
      const domain = _.get(app, '_config.domain', 'lndo.site');
      const warnings = [...model.warnings];
      const hostMap = {};
      const services = {};

      // Services first so hostMap is complete before env generation
      for (const service of Object.values(model.services)) {
        const mapped = mapService(service, model);
        Object.assign(services, mapped.services);
        Object.assign(hostMap, mapped.hostMap);
        warnings.push(...mapped.warnings);
      }

      // Apps + workers
      const targets = {};
      const cachedTokens = tokens.readTokens(app._lando, cli.vendor);
      const token = cachedTokens.length ? cachedTokens[0].token : undefined;
      const cliEnv = getCliEnv(flavor, {token, projectId, environment: branch});
      for (const [appName, modelApp] of Object.entries(model.applications)) {
        const mapped = mapApplication(modelApp, model, {xdebug: options.xdebug});
        warnings.push(...mapped.warnings);
        const env = getRuntimeEnv(model, appName, {domain, projectId, branch, hostMap});
        for (const [name, definition] of Object.entries(mapped.services)) {
          const def = _.omit(definition, ['volumes', 'upsun', 'environment', 'build', 'run']);
          if (def.webroot !== undefined) {
            def.webroot = path.posix.join(modelApp.sourceRoot, def.webroot) || '.';
            // web.locations -> nginx vhost (Lando's default vhost has no front-controller passthru)
            def.config = _.merge({vhosts: renderVhost(modelApp, def.webroot)}, def.config);
          }
          def.overrides = _.merge({}, def.overrides, {environment: env});
          def.build_as_root_internal = [...getPullBuildSteps(), getInstallStep(flavor)];
          def.build_internal = [...(definition.build || [])];
          def.run_internal = [...getMountSteps(modelApp, modelApp.sourceRoot), ...(definition.run || [])];
          if (name === closestApp) {
            def.build_internal.push(...options.build);
            def.run_internal.push(...options.run);
          }
          services[name] = def;
          if (name === appName) targets[appName] = getProxyTarget(name, definition);
        }
      }

      // Proxy
      const proxied = getProxyConfig(model, domain, targets);
      warnings.push(...proxied.warnings);

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
      options.proxy = _.merge({}, proxied.proxy, options.proxy);
      options.tooling = _.merge({}, appTooling, options.tooling);

      // Share with app.js / index.js
      app.upsun = {model, flavor, cli, closestApp, hostMap, branch, warnings: unique(warnings)};

      super(id, options);
    }
  },
};
