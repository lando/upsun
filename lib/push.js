'use strict';

// Modules
const _ = require('lodash');
const {getAuthOptions} = require('./auth');

// The non dynamic base of the task
const task = (service, closestApp) => ({
  service,
  description: 'Push relationships and/or mounts to the remote Fixed environment',
  cmd: '/helpers/upsun-push.sh',
  level: 'app',
  stdio: ['inherit', 'pipe', 'pipe'],
  options: {
    'auth': {
      describe: 'Upsun Fixed API token (PLATFORMSH_CLI_TOKEN)',
      passthrough: true,
      string: true,
      interactive: {
        type: 'list',
        message: 'Choose an Upsun Fixed account',
        choices: [],
        when: () => false,
        weight: 100,
      },
    },
    'relationship': {
      description: 'A relationship to push up, use "none" to skip',
      passthrough: true,
      alias: ['r'],
      array: true,
      interactive: {
        type: 'checkbox',
        message: 'Choose relationships to push to the remote Fixed environment',
        choices: () => {
          return _.keys(closestApp.syncableRelationships);
        },
        when: () => !_.isEmpty(closestApp.syncableRelationships),
        weight: 100,
      },
    },
    'mount': {
      description: 'A mount to push up, use "none" to skip',
      passthrough: true,
      alias: ['m'],
      array: true,
      interactive: {
        type: 'checkbox',
        message: 'Choose mounts to push to the remote Fixed environment',
        choices: () => {
          return _.keys(closestApp.mounts);
        },
        when: () => !_.isEmpty(closestApp.mounts),
        weight: 100,
      },
    },
    'env': {
      describe: 'Remote Fixed environment ID (defaults to the current git branch)',
      passthrough: true,
      alias: ['e'],
      string: true,
    },
    'project': {
      describe: 'Fixed project ID (defaults to Landofile config.id)',
      passthrough: true,
      alias: ['p'],
      string: true,
    },
    'no-parent': {
      describe: 'Do not fall back to the parent environment if resume/activate fails',
      passthrough: true,
      boolean: true,
    },
  },
});

/*
 * Helper to build a push command
 *
 * @param {string} service Closest application service name.
 * @param {object} app Lando app (`options._app`) with meta, platformsh, and id.
 * @returns {object} Tooling task.
 */
exports.getPlatformPush = (service, app = {}) => {
  const {meta, platformsh} = app;
  const push = _.merge({}, task(service, platformsh.closestApp), {options: getAuthOptions(meta, platformsh.tokens)});
  if (app.id) {
    push.options.project.default = app.id;
    push.options.project.defaultDescription = app.id;
  }
  return push;
};
