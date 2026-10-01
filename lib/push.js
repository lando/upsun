'use strict';

const _ = require('lodash');
const {getPullTask} = require('./pull');

/**
 * Build the `lando push` tooling task for one model application.
 *
 * @param {import('./config/config.types').UpsunModel} model Normalized Upsun model.
 * @param {string} appName Model application name and Lando service name.
 * @param {import('./mapping/mapping.types').SyncCliMeta} cli Resolved CLI metadata plus optional project/environment defaults.
 * @param {import('./mapping/mapping.types').TokenEntry[]} tokens Cached vendor token entries.
 * @param {function(): Promise<string|undefined>} [login] Browser login callback.
 * @returns {import('./mapping/mapping.types').ToolingTask} Lando tooling task.
 */
exports.getPushTask = (model, appName, cli, tokens = [], login) => {
  const task = getPullTask(model, appName, cli, tokens, login);
  return {
    ...task,
    description: 'Push databases and mounts to an Upsun environment',
    cmd: '/helpers/upsun-push.sh',
    options: {
      ..._.omit(task.options, ['all-mounts']),
      relationship: {
        ...task.options.relationship,
        description: 'A database relationship to push, use "none" to skip',
        interactive: {...task.options.relationship.interactive, message: 'Choose database relationships to push'},
      },
      mount: {
        ...task.options.mount,
        description: 'A mount to upload, use "none" to skip',
        interactive: {...task.options.mount.interactive, message: 'Choose mounts to upload'},
      },
      force: {describe: 'Allow pushing to the production environment', passthrough: true, boolean: true},
    },
  };
};
