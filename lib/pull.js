'use strict';

const {getAuthOptions} = require('./auth');
const {getCliEnv} = require('./cli');

const DATABASE_TYPES = new Set(['mariadb', 'mysql', 'oracle-mysql', 'postgresql']);
const DATABASE_ENDPOINTS = new Set(['mysql', 'pgsql', 'postgresql']);
// jq is what Upsun's own .environment templates use to unpack PLATFORM_* payloads
const CLIENT_INSTALL_STEP = 'apt-get update && apt-get install -y mariadb-client postgresql-client jq';

const getFlavor = cli => cli.flavor || (cli.vendor === 'platformsh' ? 'fixed' : 'flex');
const getToken = tokens => tokens.length > 0 ? tokens[0].token : undefined;
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
      when: () => getRelationships(model, app).length > 0,
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
      when: () => Object.keys(app.mounts || {}).length > 0,
      weight: 111,
    },
  },
  'env': {describe: 'Remote environment ID', passthrough: true, alias: ['e'], string: true},
  'project': {describe: 'Remote project ID', passthrough: true, alias: ['p'], string: true},
  'no-parent': {describe: 'Disable parent environment fallback', passthrough: true, boolean: true},
});

/**
 * Return root build steps required by pull and push database operations.
 *
 * @returns {string[]} Lando `build_as_root` steps.
 */
exports.getPullBuildSteps = () => [CLIENT_INSTALL_STEP];

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
        token: getToken(tokens),
        projectId: cli.projectId,
        environment: cli.environment,
      }),
      UPSUN_CLI_BINARY: cli.binary,
      UPSUN_CLI_TOKEN_VAR: cli.tokenVar,
    },
  };
};
