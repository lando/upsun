'use strict';

const path = require('path').posix;
const {renderVhost} = require('../nginx');
const {getDependencySteps, getExtensionStep, renderPhpIni} = require('./php');
const {resolveVersion} = require('./versions');

const RUNTIME_TYPES = Object.freeze({
  php: 'php',
  nodejs: 'node',
  python: 'python',
  ruby: 'ruby',
  golang: 'go',
});

const PHP_APT_STEP = 'apt-get update && apt-get install -y jq';
const RUNTIME_APT_STEP =
  'apt-get update && apt-get install -y mariadb-client postgresql-client jq rsync openssh-client';
const MAIL_STEP = 'printf \'sendmail_path = "/helpers/mailpit sendmail -t --smtp-addr mailpit:25"\\n\' > ' +
  '/usr/local/etc/php/conf.d/zzzz-upsun-mail.ini';

const flavorBuild = app => {
  const flavor = app.build?.flavor;
  if (app.type.runtime === 'php' && (flavor === undefined || flavor === 'composer')) {
    return ['if [ -f composer.json ]; then composer --no-ansi --no-interaction install --no-progress --prefer-dist ' +
      '--optimize-autoloader; fi'];
  }
  if (app.type.runtime === 'nodejs' && (flavor === undefined || flavor === 'default')) {
    return ['if [ -f package.json ]; then npm install --no-audit --no-fund; fi'];
  }
  return [];
};

const composerVersion = app => {
  const composer = app.dependencies?.php?.['composer/composer'];
  if (typeof composer === 'string' && /(^|[^0-9])2(?:\D|$)/.test(composer)) return '2';
  return app.build?.flavor === 'composer' ? '2' : undefined;
};

const overridesFor = app => {
  const hosts = Object.entries(app.additional_hosts || {}).map(([host, ip]) => `${host}:${ip}`);
  return hosts.length ? {extra_hosts: hosts} : undefined;
};

const phpSetup = (app, opts) => {
  const extension = getExtensionStep(app.runtime);
  const appRoot = path.join('/app', app.sourceRoot || '');
  const steps = [PHP_APT_STEP];
  if (extension.step) steps.push(extension.step);
  steps.push(`if [ -f "${appRoot}/php.ini" ]; then ln -sf "${appRoot}/php.ini" ` +
    '/usr/local/etc/php/conf.d/zzz-upsun-app.ini; fi');
  const node = app.composable?.runtimes?.slice(1).find(runtime => runtime.runtime === 'nodejs');
  if (node) steps.push(`/helpers/upsun-install-node.sh ${node.version}`);
  if (opts.mail !== false) steps.push(MAIL_STEP);
  return {steps, unsupported: extension.unsupported};
};

const appMetadata = (app, proxy, staticApp) => ({
  role: 'app',
  app: app.name,
  locations: app.web.locations,
  relationships: {...(app.relationships || {})},
  proxy,
  static: staticApp,
});

const createAppDefinition = (app, opts, landoType, version, buildAsRoot) => {
  const locations = Object.keys(app.web?.locations || {});
  const hasSidecar = landoType !== 'php' && locations.length > 0;
  const viaNginx = landoType === 'php' || locations.length > 0;
  const proxy = {service: viaNginx ? `${app.name}_nginx` : app.name,
    port: viaNginx ? 80 : 8888};
  const definition = {
    type: `${landoType}:${version}`,
    ssl: true,
    build_as_root: [...buildAsRoot],
    build: [
      ...getDependencySteps(app.dependencies),
      ...flavorBuild(app),
      ...(app.hooks?.build ? ['/helpers/upsun-hook.sh build'] : []),
    ],
    upsun: appMetadata(app, proxy, hasSidecar && !app.web?.commands?.start),
  };
  const overrides = overridesFor(app);
  if (overrides) definition.overrides = overrides;

  if (landoType === 'php') {
    const webroot = path.join(app.sourceRoot || '', app.web?.document_root || '') || '.';
    definition.via = 'nginx';
    definition.webroot = webroot;
    definition.config = {vhosts: renderVhost(app, webroot, {upstream: null})};
    if (Object.keys(app.variables?.php || {}).length) definition.config.php = renderPhpIni(app.variables.php);
    definition.xdebug = opts.xdebug ?? false;
    const composer = composerVersion(app);
    if (composer) definition.composer_version = composer;
  } else {
    definition.command = '/helpers/upsun-start.sh';
    definition.port = 8888;
  }
  return definition;
};

const createRoleDefinition = (app, appDefinition, role, name, command, relationships, buildAsRoot) => {
  const definition = {
    ...appDefinition,
    ssl: false,
    command,
    build_as_root: [...buildAsRoot],
    build: [],
    upsun: {
      ...appDefinition.upsun,
      role,
      relationships,
      proxy: null,
      static: false,
    },
  };
  if (role === 'worker') definition.upsun.worker = name;
  const overrides = overridesFor(app);
  if (overrides) definition.overrides = overrides;
  else delete definition.overrides;
  if (appDefinition.via === 'nginx') {
    definition.via = 'cli';
    delete definition.port;
  } else {
    definition.port = false;
  }
  return definition;
};

const createNginxSidecar = app => {
  const webroot = path.join(app.sourceRoot || '', app.web?.document_root || '') || '.';
  return {
    type: 'nginx',
    ssl: true,
    webroot,
    config: {vhosts: renderVhost(app, webroot, {upstream: {service: app.name, port: 8888}})},
    upsun: {role: 'nginx', app: app.name},
  };
};

const warningForRuntime = app => ({
  code: 'runtime-unsupported',
  message: `Upsun runtime ${app.type.runtime} is not supported by a bundled Lando service plugin.`,
  data: {app: app.name, runtime: app.type.runtime, version: String(app.type.version)},
});

/**
 * Maps an Upsun application runtime and its role sidecars to Lando service definitions.
 *
 * @param {import('../config/config.types').UpsunApplication} app Normalized model application.
 * @param {import('./mapping.types').MappingOptions} opts Mapping options.
 * @returns {import('./mapping.types').MapResult}
 */
const mapRuntime = (app, opts = {}) => {
  const landoType = RUNTIME_TYPES[app.type.runtime];
  if (!landoType) return {services: {}, warnings: [warningForRuntime(app)]};

  const resolved = resolveVersion(landoType, app.type.version, opts.versions?.[landoType]);
  const setup = landoType === 'php' ? phpSetup(app, opts) : {steps: [RUNTIME_APT_STEP], unsupported: []};
  const appDefinition = createAppDefinition(app, opts, landoType, resolved.version, setup.steps);
  /** @type {import('./mapping.types').MappedServices} */
  const services = {[app.name]: appDefinition};

  if (landoType !== 'php' && Object.keys(app.web?.locations || {}).length) {
    services[`${app.name}_nginx`] = createNginxSidecar(app);
  }
  for (const [workerName, worker] of Object.entries(app.workers || {})) {
    const relationships = {...(app.relationships || {}), ...(worker.relationships || {})};
    services[`${app.name}--${workerName}`] = createRoleDefinition(app, appDefinition, 'worker', workerName,
        '/helpers/upsun-start.sh', relationships, setup.steps);
    const workerCommand = worker.commands?.start;
    if (workerCommand) {
      const definition = services[`${app.name}--${workerName}`];
      definition.overrides = definition.overrides || {};
      definition.overrides.environment = {PLATFORM_APP_COMMAND: workerCommand};
    }
  }
  if (opts.crons === true && Object.keys(app.crons || {}).length) {
    services[`${app.name}--cron`] = createRoleDefinition(app, appDefinition, 'cron', null,
        '/helpers/upsun-crond.sh', {...(app.relationships || {})},
        [...setup.steps, '/helpers/upsun-install-supercronic.sh']);
  }

  /** @type {import('../config/config.types').UpsunWarning[]} */
  const warnings = setup.unsupported.map(extension => ({
    code: 'php-extension-unsupported',
    message: `PHP extension ${extension} cannot be installed locally and is skipped.`,
    data: {app: app.name, extension},
  }));
  if (resolved.warning) warnings.unshift(resolved.warning);
  return {services, warnings};
};

exports.RUNTIME_TYPES = RUNTIME_TYPES;
exports.mapRuntime = mapRuntime;
