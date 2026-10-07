'use strict';

const path = require('path').posix;
const {shellQuote} = require('../shell');
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
const DEFAULT_NODE_VERSION = '22';
const dependencyEnabled = value => value !== false && value !== null;

// apt >= 2.3 defaults to three retries; older Debian-based images default to zero.
const PHP_APT_STEP = 'apt-get -o Acquire::Retries=3 update && apt-get -o Acquire::Retries=3 install -y jq';
const RUNTIME_APT_STEP =
  'apt-get -o Acquire::Retries=3 update && ' +
  'apt-get -o Acquire::Retries=3 install -y mariadb-client postgresql-client jq rsync openssh-client';
const MAIL_STEP = 'printf \'sendmail_path = "/helpers/mailpit sendmail -t --smtp-addr mailpit:25"\\n\' > ' +
  '/usr/local/etc/php/conf.d/zzzz-upsun-mail.ini';

const flavorBuild = app => {
  const flavor = app.build?.flavor;
  const directory = app.sourceRoot ? `cd ${shellQuote(path.join('/app', app.sourceRoot))} && ` : '';
  if (app.type.runtime === 'php' && (flavor === undefined || flavor === 'composer')) {
    return [directory + 'if [ -f composer.json ]; then composer --no-ansi --no-interaction install ' +
      '--no-progress --prefer-dist --optimize-autoloader; fi'];
  }
  if (app.type.runtime === 'nodejs' && (flavor === undefined || flavor === 'default')) {
    return [directory + 'if [ -f package.json ]; then npm install --no-audit --no-fund; fi'];
  }
  return [];
};

const composerVersion = app => {
  const composer = app.dependencies?.php?.['composer/composer'];
  if (typeof composer === 'string') {
    if (/^\d+\.\d+\.\d+$/.test(composer) || /^[12](?:-latest)?$/.test(composer)) return composer;
    const major = /^[~^]([12])(?:\.\d+){0,2}$/.exec(composer);
    if (major) return major[1];
  }
  return app.build?.flavor === 'composer' ? '2' : undefined;
};

// Upsun loads Xdebug when the app declares an IDE key; the Landofile's config.xdebug overrides that either way
const xdebugMode = (app, opts) => {
  if (typeof opts.xdebug === 'string') return opts.xdebug;
  if (opts.xdebug === true || (opts.xdebug == null && app.runtime?.xdebug?.idekey)) return 'debug';
  return 'off';
};

const overridesFor = app => {
  const hosts = Object.entries(app.additional_hosts || {}).map(([host, ip]) => `${host}:${ip}`);
  const overrides = hosts.length ? {extra_hosts: hosts} : {};
  // The PHP plugin exports XDEBUG_MODE, which Xdebug reads over php.ini at startup. Blank it (Xdebug ignores an
  // empty value) so the generated ini and the xdebug-on/off toggle decide the mode for php-fpm and the CLI alike.
  if (app.type.runtime === 'php') overrides.environment = {XDEBUG_MODE: ''};
  return Object.keys(overrides).length ? overrides : undefined;
};

const phpSetup = (app, opts) => {
  // The PHP plugin enables the bundled Xdebug itself whenever the mode is not off
  const pluginEnables = xdebugMode(app, opts) !== 'off';
  const extensions = (app.runtime?.extensions || []).filter(name => name !== 'xdebug' || !pluginEnables);
  const extension = getExtensionStep({...app.runtime, extensions});
  const appRoot = path.join('/app', app.sourceRoot || '');
  const steps = [PHP_APT_STEP];
  if (extension.step) steps.push(extension.step);
  steps.push(`if [ -f ${shellQuote(`${appRoot}/php.ini`)} ]; then ln -sf ${shellQuote(`${appRoot}/php.ini`)} ` +
    '/usr/local/etc/php/conf.d/zzz-upsun-app.ini; fi');
  const node = app.composable?.runtimes?.slice(1).find(runtime => runtime.runtime === 'nodejs');
  if (node || Object.values(app.dependencies?.nodejs || {}).some(dependencyEnabled)) {
    const version = node?.version || DEFAULT_NODE_VERSION;
    if (!/^[0-9][A-Za-z0-9.+-]*$/.test(version)) throw new Error(`Invalid Node.js version: ${version}`);
    steps.push(`/helpers/upsun-install-node.sh ${version}`);
  }
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
      ...getDependencySteps(Object.fromEntries(Object.entries(app.dependencies || {})
          .filter(([group]) => landoType === 'python' || !group.startsWith('python')))),
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
    const mode = xdebugMode(app, opts);
    const idekey = app.runtime?.xdebug?.idekey || null;
    definition.config = {
      vhosts: renderVhost(app, webroot, {upstream: null, fpmHost: app.name}),
      // variables.php comes last so it wins over the Upsun IDE key
      php: renderPhpIni({
        'xdebug.mode': mode,
        ...(idekey ? {'xdebug.idekey': idekey} : {}),
        ...(app.variables?.php || {}),
      }),
    };
    definition.xdebug = mode === 'off' ? false : mode;
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
  } else if (app.type.runtime === 'nodejs') {
    definition.port = false;
  }
  return definition;
};

const createNginxSidecar = app => {
  const webroot = path.join(app.sourceRoot || '', app.web?.document_root || '') || '.';
  const upstream = app.web?.commands?.start ? {service: app.name, port: 8888} : null;
  return {
    type: 'nginx',
    ssl: true,
    webroot,
    config: {vhosts: renderVhost(app, webroot, {upstream, fpmHost: null})},
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
    const definition = services[`${app.name}--${workerName}`];
    definition.overrides = definition.overrides || {};
    definition.overrides.environment = {...definition.overrides.environment,
      PLATFORM_APP_COMMAND: worker.commands?.start || '',
      PLATFORM_PRE_APP_COMMAND: '', PLATFORM_POST_APP_COMMAND: ''};
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
  const composer = app.dependencies?.php?.['composer/composer'];
  if (landoType === 'php' && composer != null && dependencyEnabled(composer) &&
    !(/^(?:\d+\.\d+\.\d+|[12](?:-latest)?|[~^][12](?:\.\d+){0,2})$/.test(String(composer)))) {
    warnings.push({
      code: 'version-fallback',
      message: `Composer version ${composer} for ${app.name} cannot be represented locally; ` +
        `using ${appDefinition.composer_version || 'the PHP image default'}.`,
      data: {app: app.name, wanted: String(composer)},
    });
  }
  if (landoType !== 'python') {
    for (const [group, dependencies] of Object.entries(app.dependencies || {})) {
      if (group.startsWith('python') && Object.values(dependencies).some(dependencyEnabled)) {
        warnings.push({
          code: 'dependency-runtime-missing',
          message: `Application ${app.name} declares ${group} dependencies without a local Python runtime; ` +
            'dependency installation is skipped.',
          data: {app: app.name, runtime: group},
        });
      }
    }
  }
  if ((landoType === 'php' && app.web?.commands?.start) ||
    (landoType !== 'php' && app.web?.upstream?.socket_family === 'unix')) {
    warnings.push({
      code: 'web-upstream-unsupported',
      message: `Application ${app.name} uses web upstream settings not supported locally; ` +
        (landoType === 'php' ? 'PHP-FPM is used instead of web.commands.start.' :
          'TCP is used instead of Unix sockets.'),
      data: {app: app.name},
    });
  }
  return {services, warnings};
};

exports.RUNTIME_TYPES = RUNTIME_TYPES;
exports.mapRuntime = mapRuntime;
