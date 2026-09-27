'use strict';

const {getAuthOptions} = require('./auth');
const {getCliEnv} = require('./cli');

const DATABASE_TYPES = new Set(['mariadb', 'mysql', 'oracle-mysql', 'postgresql']);
const DATABASE_ENDPOINTS = new Set(['mysql', 'pgsql', 'postgresql']);

const getFlavor = cli => cli.flavor || (cli.vendor === 'platformsh' ? 'fixed' : 'flex');
const getApp = (model, appName) => {
  const app = model.applications[appName];
  if (!app) throw new Error(`Unknown Upsun application: ${appName}`);
  return app;
};
const getRelationships = (model, app) => Object.keys(app.relationships || {}).filter(name => {
  const relationship = app.relationships[name];
  const service = model.services[relationship.service];
  return DATABASE_ENDPOINTS.has(relationship.endpoint) ||
    Boolean(service && DATABASE_TYPES.has(service.type.service));
});

const getOptions = (model, app, tokens) => ({
  ...getAuthOptions({}, tokens),
  'relationship': {
    description: 'A database relationship to import, use "none" to skip',
    passthrough: true,
    alias: ['r'],
    array: true,
    interactive: {
      type: 'checkbox',
      message: 'Choose database relationships to import',
      choices: getRelationships(model, app),
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
  'skip-db': {describe: 'Skip database sync', passthrough: true, boolean: true,
    interactive: {type: 'confirm', when: () => false, weight: 105}},
  'skip-files': {describe: 'Skip file sync', passthrough: true, boolean: true,
    interactive: {type: 'confirm', when: () => false, weight: 106}},
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
 * @param {object} model Normalized Upsun model.
 * @param {string} appName Model application name and Lando service name.
 * @param {object} cli Resolved CLI metadata plus optional project/environment defaults.
 * @param {Array} tokens Cached vendor token entries.
 * @returns {object} Lando tooling task.
 */
exports.getPullTask = (model, appName, cli, tokens = []) => {
  const app = getApp(model, appName);
  return {
    service: appName,
    description: 'Pull databases and mounts from an Upsun environment',
    cmd: '/helpers/upsun-pull.sh',
    level: 'app',
    stdio: ['inherit', 'pipe', 'pipe'],
    options: getOptions(model, app, tokens),
    env: {
      ...getCliEnv(getFlavor(cli), {
        token: tokens.length > 0 ? tokens[0].token : undefined,
        projectId: cli.projectId,
        environment: cli.environment,
      }),
      UPSUN_CLI_BINARY: cli.binary,
      UPSUN_CLI_TOKEN_VAR: cli.tokenVar,
    },
  };
};
