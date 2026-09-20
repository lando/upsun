'use strict';

const {getPullTask} = require('./pull');

/**
 * Build the `lando push` tooling task for one model application.
 *
 * @param {object} model Normalized Upsun model.
 * @param {string} appName Model application name and Lando service name.
 * @param {object} cli Resolved CLI metadata plus optional project/environment defaults.
 * @param {Array} tokens Cached vendor token entries.
 * @returns {object} Lando tooling task.
 */
exports.getPushTask = (model, appName, cli, tokens = []) => {
  const task = getPullTask(model, appName, cli, tokens);
  return {
    ...task,
    description: 'Push databases and mounts to an Upsun environment',
    cmd: '/helpers/upsun-push.sh',
    options: {
      ...task.options,
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
