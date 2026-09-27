'use strict';

const EXEC = '/helpers/upsun-exec.sh';

/**
 * Replace unsupported Adobe Commerce Cloud remote operations with actionable errors.
 * @param {string} appName Lando application service.
 * @returns {object} Lando tooling block.
 */
exports.getMagentoTooling = appName => Object.fromEntries(['pull', 'push', 'tether'].map(command => {
  const message = `lando ${command} is not available for Adobe Commerce Cloud projects; use the magento-cloud CLI.`;
  return [command, {service: appName, description: message, cmd: `sh -c 'echo "${message}" >&2; exit 1'`}];
}));

const LANGUAGE_TOOLING = {
  php: {php: 'php', composer: 'composer'},
  node: {node: 'node', npm: 'npm', yarn: 'yarn'},
  python: {python: 'python', pip: 'pip'},
  ruby: {ruby: 'ruby', bundle: 'bundle'},
  go: {go: 'go'},
};

// Endpoints without a default schema have a null path; connect without selecting a database then
const database = host => host.path ? ` ${host.path}` : '';

// Relationship shells keyed by the Lando service type prefix
const SHELLS = {
  mariadb: host => ({cmd: `mysql -u${host.username} -p${host.password}${database(host)}`}),
  mysql: host => ({cmd: `mysql -u${host.username} -p${host.password}${database(host)}`}),
  postgres: host => ({cmd: `psql -U ${host.username}${database(host)}`, env: {PGPASSWORD: host.password || ''}}),
  redis: () => ({cmd: 'redis-cli'}),
  valkey: () => ({cmd: 'valkey-cli'}),
  mongo: () => ({cmd: 'mongosh'}),
};

/**
 * Language tooling (`lando php`, `lando composer`, ...) for an app service.
 *
 * @param {string} appName Lando service name of the app.
 * @param {string} landoType Lando service type prefix, eg `php`.
 * @param {object} extra Extra keys merged into every command (eg `dir`, `env`).
 * @returns {object} Lando tooling block.
 */
exports.getLanguageTooling = (appName, landoType, extra = {}) => Object.fromEntries(
    Object.entries(LANGUAGE_TOOLING[landoType] || {})
        .map(([name, cmd]) => [name, {service: appName, cmd: `${EXEC} ${cmd}`, ...extra}]),
);

/**
 * Framework tooling detected from the app's composer.json (currently drush).
 *
 * @param {string} appName Lando service name of the app.
 * @param {string} appDir Absolute app directory inside the container.
 * @param {Set<string>|string[]} packages Composer package names the app installs.
 * @param {object} extra Extra keys merged into every command.
 * @returns {object} Lando tooling block.
 */
exports.getComposerTooling = (appName, appDir, packages, extra = {}) => {
  const installed = new Set(packages || []);
  const tooling = {};
  if (installed.has('drush/drush')) {
    tooling.drush = {service: appName, cmd: `${EXEC} ${appDir}/vendor/bin/drush`, ...extra};
  }
  return tooling;
};

/**
 * Prefix a command so it runs with the Upsun shell environment.
 *
 * @param {string} cmd Command string.
 * @returns {string} Wrapped command.
 */
exports.withEnv = cmd => `${EXEC} ${cmd}`;

/**
 * Per-relationship database shells (`lando database`, `lando redis`, ...).
 *
 * @param {object} app Model application.
 * @param {object} landoServices Generated Lando services keyed by name.
 * @param {object} hostMap Mapping host map.
 * @returns {object} Lando tooling block.
 */
exports.getRelationshipTooling = (app, landoServices, hostMap) => {
  const tooling = {};
  for (const [name, relationship] of Object.entries(app.relationships || {})) {
    const service = landoServices[relationship.service];
    const host = hostMap[`${relationship.service}#${relationship.endpoint}`] || hostMap[relationship.service];
    if (!service || !host) continue;
    const type = String(service.services?.image).startsWith('valkey/valkey') ?
      'valkey' :
      String(service.type).split(':')[0];
    const shell = SHELLS[type];
    if (!shell) continue;
    tooling[name] = {
      service: relationship.service,
      description: `Drops into a shell on the ${name} relationship`,
      ...shell(host),
    };
  }
  return tooling;
};

/**
 * Standard SQL import/export helpers, preferring the app's first SQL relationship.
 * Model service names are also the keys of the generated Lando services.
 *
 * @param {string} appName Model application name.
 * @param {object} model Normalized Upsun model.
 * @param {object} landoServices Generated Lando services keyed by name.
 * @returns {object} Lando tooling block, empty when no SQL service exists.
 */
exports.getDatabaseTooling = (appName, model, landoServices) => {
  const sqlTypes = ['mariadb', 'mysql', 'oracle-mysql', 'postgresql'];
  const sqlServices = Object.keys(model.services || {}).filter(name =>
    sqlTypes.includes(model.services[name].type.service) && landoServices[name]);
  const relationships = Object.values(model.applications?.[appName]?.relationships || {});
  const primary = relationships.find(relationship => sqlServices.includes(relationship.service));
  const host = primary?.service || sqlServices[0];
  if (!host) return {};

  return {
    'db-import <file>': {
      service: ':host',
      description: 'Imports a dump file into an Upsun database service',
      cmd: '/helpers/sql-import.sh',
      user: 'root',
      options: {
        'host': {
          description: 'The database service to use',
          default: host,
          alias: ['h'],
        },
        'no-wipe': {
          description: 'Do not destroy the existing database before an import',
          boolean: true,
        },
      },
    },
    'db-export [file]': {
      service: ':host',
      description: 'Exports database from an Upsun database service to a file',
      cmd: '/helpers/sql-export.sh',
      user: 'root',
      options: {
        host: {
          description: 'The database service to use',
          default: host,
          alias: ['h'],
        },
        stdout: {
          description: 'Dump database to stdout',
        },
      },
    },
  };
};

/**
 * `lando cron <name>` commands for every cron defined on the app.
 *
 * @param {string} appName Lando service name of the app.
 * @param {object} app Model application.
 * @returns {object} Lando tooling block (empty when the app has no crons).
 */
exports.getCronTooling = (appName, app) => {
  const names = Object.keys(app.crons || {});
  if (names.length === 0) return {};
  return {
    'cron <name>': {
      service: appName,
      description: `Runs an Upsun cron once (${names.join(', ')})`,
      cmd: '/helpers/upsun-cron.sh',
    },
  };
};

/**
 * `lando operation <name>` for every runtime operation defined on the app.
 *
 * @param {string} appName Lando service name of the app.
 * @param {object} app Model application.
 * @returns {object} Lando tooling block (empty when the app has no operations).
 */
exports.getOperationTooling = (appName, app) => {
  const names = Object.keys(app.operations || {});
  if (names.length === 0) return {};
  return {
    'operation <name>': {
      service: appName,
      description: `Runs an Upsun runtime operation once (${names.join(', ')})`,
      cmd: '/helpers/upsun-operation.sh',
    },
  };
};

/**
 * Xdebug toggle commands for a PHP app service.
 *
 * @param {string} appName Lando service name of the app.
 * @returns {object} Lando tooling block.
 */
exports.getXdebugTooling = appName => ({
  'xdebug-on': {
    service: appName,
    description: 'Enables Xdebug (optional mode, default debug)',
    cmd: '/helpers/upsun-xdebug.sh on',
    user: 'root',
  },
  'xdebug-off': {
    service: appName,
    description: 'Disables Xdebug',
    cmd: '/helpers/upsun-xdebug.sh off',
    user: 'root',
  },
});

/**
 * Tether management command for a tethered app service.
 *
 * @param {string} appName Lando service name of the app.
 * @param {object} env CLI environment passed through to the command.
 * @returns {object} Lando tooling block.
 */
exports.getTetherTooling = (appName, env) => ({
  tether: {
    service: appName,
    description: 'Opens (or refreshes) tunnels to the tethered Upsun environment; --close / --info',
    cmd: '/helpers/upsun-tether.sh',
    user: 'root',
    env,
  },
});
