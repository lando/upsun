'use strict';

const _ = require('lodash');
const {getPullTask} = require('./pull');

/**
 * Build `lando switch <environment>`; Lando passes the environment through as argv.
 *
 * @param {import('./config/config.types').UpsunModel} model Normalized Upsun model.
 * @param {string} appName Model application name and Lando service name.
 * @param {import('./mapping/mapping.types').SyncCliMeta} cli Resolved CLI metadata plus optional project/environment defaults.
 * @param {import('./mapping/mapping.types').TokenEntry[]} tokens Cached vendor token entries.
 * @returns {import('./mapping/mapping.types').ToolingTask} Lando tooling task.
 */
exports.getSwitchTask = (model, appName, cli, tokens = []) => {
  const task = getPullTask(model, appName, cli, tokens);
  return {
    ...task,
    description: 'Check out an Upsun environment and pull its databases and mounts (required: <environment>)',
    cmd: '/helpers/upsun-switch.sh',
    options: _.omit(task.options, ['all-mounts', 'env']),
  };
};
