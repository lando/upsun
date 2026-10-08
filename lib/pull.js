'use strict';

const {getAuthOptions} = require('./auth');
const {getCliEnv} = require('./cli');
const {DATABASE_TYPES: SQL_DIALECTS, REPLICA_TYPES} = require('./mapping/database');

const DATABASE_TYPES = new Set(Object.keys(SQL_DIALECTS));
const DATABASE_ENDPOINTS = new Set(['mysql', 'pgsql', 'postgresql']);

const getFlavor = cli => cli.flavor || (cli.vendor === 'platformsh' ? 'fixed' : 'flex');
const getApp = (model, appName) => {
  const app = model.applications[appName];
  if (!app) throw new Error(`Unknown Upsun application: ${appName}`);
  return app;
};
const isReplica = (model, relationship) => Boolean(REPLICA_TYPES[model.services[relationship.service]?.type.service]);
const getReplicaRelationships = (model, app) => Object.keys(app.relationships || {})
  .filter(name => isReplica(model, app.relationships[name]));
const getRelationships = (model, app) => Object.keys(app.relationships || {}).filter(name => {
  const relationship = app.relationships[name];
  const service = model.services[relationship.service];
  if (isReplica(model, relationship)) return false;
  return DATABASE_ENDPOINTS.has(relationship.endpoint) ||
    Boolean(service && DATABASE_TYPES.has(service.type.service));
});

const copyAlias = alias => answers => {
  // Yargs boolean-negation parses `--no-db` as `{db: false}`, not as the alias.
  // `--no-skip-db` stays false and must not count as a skip. App-level prompts
  // run the live function after init; the cached copy loses it.
  if (process.argv.some(arg => arg === `--${alias}` ||
    (arg.startsWith(`--${alias}=`) && !['false', '0'].includes(arg.slice(alias.length + 3))))) {
    answers[alias === 'no-db' ? 'skip-db' : 'skip-files'] = true;
  }
  return false;
};

const getOptions = (model, app, tokens, login, account) => ({
  ...getAuthOptions(account, tokens, login),
  'relationship': {
    description: 'A database relationship to import, use "none" to skip',
    passthrough: true,
    alias: ['r'],
    array: true,
    interactive: {
      type: 'checkbox',
      message: 'Choose database relationships to import',
      choices: getRelationships(model, app),
      // Pre-select the first relationship so the common single-database case needs no toggling.
      // Inquirer only ticks the choices a default names, so a stale default read back out of the
      // tooling cache degrades to nothing selected instead of erroring.
      default: getRelationships(model, app).slice(0, 1),
      when: answers => !answers['skip-db'] && getRelationships(model, app).length > 0,
      weight: 110,
    },
  },
  'mount': {
    description: 'A mount to download, use "none" to skip',
    passthrough: true,
    alias: ['m'],
    array: true,
    interactive: {
      type: 'checkbox',
      message: 'Choose mounts to download',
      choices: Object.keys(app.mounts || {}),
      // Same idea as relationships: the first mount is the one people usually want.
      default: Object.keys(app.mounts || {}).slice(0, 1),
      when: answers => !answers['skip-files'] && Object.keys(app.mounts || {}).length > 0,
      weight: 111,
    },
  },
  'env': {describe: 'Remote environment ID', passthrough: true, alias: ['e'], string: true},
  'project': {describe: 'Remote project ID', passthrough: true, alias: ['p'], string: true},
  'no-parent': {describe: 'Disable parent environment fallback', passthrough: true, boolean: true},
  'all-mounts': {describe: 'Download every mount', passthrough: true, boolean: true},
  // The silent interactive blocks make Lando copy the argv flags into the inquirer answers
  // so the relationship and mount prompts above can skip themselves
  'skip-db': {describe: 'Skip database sync', passthrough: true, boolean: true, alias: ['no-db'],
    interactive: {type: 'confirm', when: copyAlias('no-db'), weight: 105}},
  'skip-files': {describe: 'Skip file sync', passthrough: true, boolean: true, alias: ['no-files'],
    interactive: {type: 'confirm', when: copyAlias('no-files'), weight: 106}},
  'app': {
    describe: 'Upsun application (defaults to PLATFORM_APPLICATION_NAME)',
    passthrough: true,
    alias: ['A'],
    string: true,
  },
});

/**
 * Build the `lando pull` tooling task for one model application.
 *
 * @param {import('./config/config.types').UpsunModel} model Normalized Upsun model.
 * @param {string} appName Model application name and Lando service name.
 * @param {import('./mapping/mapping.types').SyncCliMeta} cli Resolved CLI metadata plus optional project/environment defaults.
 * @param {import('./mapping/mapping.types').TokenEntry[]} tokens Cached vendor token entries.
 * @param {function(): Promise<string|undefined>} [login] Browser login callback.
 * @param {object} [account] App-cached account selection, already checked against the vendor cache.
 * @param {string} [account.email] Account email.
 * @param {string} [account.token] API token.
 * @returns {import('./mapping/mapping.types').ToolingTask} Lando tooling task.
 */
exports.getPullTask = (model, appName, cli, tokens = [], login, account = {}) => {
  const app = getApp(model, appName);
  const replicas = getReplicaRelationships(model, app);
  return {
    service: appName,
    description: 'Pull databases and mounts from an Upsun environment',
    cmd: '/helpers/upsun-pull.sh',
    level: 'app',
    stdio: ['inherit', 'pipe', 'pipe'],
    options: getOptions(model, app, tokens, login, account),
    env: {
      ...getCliEnv(getFlavor(cli), {
        projectId: cli.projectId,
        environment: cli.environment,
      }),
      UPSUN_CLI_BINARY: cli.binary,
      UPSUN_CLI_TOKEN_VAR: cli.tokenVar,
      // Explicit `-r` selections bypass the prompt filter, so the script rejects replicas itself.
      ...(replicas.length ? {UPSUN_SYNC_REPLICAS: replicas.join(' ')} : {}),
    },
  };
};
