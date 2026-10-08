'use strict';

const _ = require('lodash');
const {getPullTask} = require('./pull');
const {getEnvironments} = require('./api');

/**
 * Build `lando switch [environment]` with an optional interactive environment picker.
 *
 * @param {import('./config/config.types').UpsunModel} model Normalized Upsun model.
 * @param {string} appName Model application name and Lando service name.
 * @param {import('./mapping/mapping.types').SyncCliMeta} cli Resolved CLI metadata plus optional project/environment defaults.
 * @param {import('./mapping/mapping.types').TokenEntry[]} tokens Cached vendor token entries.
 * @param {function(): Promise<string|undefined>} [login] Browser login callback.
 * @param {object} [account] App-cached account selection.
 * @param {string} [account.email] Account email.
 * @param {string} [account.token] API token.
 * @returns {import('./mapping/mapping.types').ToolingTask} Lando tooling task.
 */
exports.getSwitchTask = (model, appName, cli, tokens = [], login, account = {}) => {
  const task = getPullTask(model, appName, cli, tokens, login, account);
  return {
    ...task,
    description: 'Check out an Upsun environment and pull its databases and mounts',
    cmd: '/helpers/upsun-switch.sh',
    options: {
      ..._.omit(task.options, ['all-mounts', 'env']),
      auth: {
        ...task.options.auth,
        interactive: task.options.auth.interactive || {type: 'input', when: () => false, weight: 100},
      },
      project: {
        ...task.options.project,
        interactive: {type: 'input', when: () => false, weight: 102},
      },
      environment: {
        describe: 'Upsun environment to check out',
        passthrough: true,
        alias: ['env', 'e'],
        string: true,
        interactive: {
          type: 'list',
          message: 'Choose an Upsun environment',
          weight: 103,
          when: answers => !answers.environment,
          choices: async answers => {
            const projectId = answers.project || cli.projectId;
            if (!projectId) throw new Error('No Upsun project configured. Specify --project to choose an environment.');
            let environments;
            try {
              environments = await getEnvironments(answers.auth, projectId);
            } catch (error) {
              if ([400, 401, 403].includes(error.status)) {
                throw new Error('Upsun rejected that API token. Run lando auth upsun again.');
              }
              throw new Error(`Couldn't list environments for ${projectId}: ${error.message}`);
            }
            if (!environments.length) throw new Error(`No environments found for Upsun project ${projectId}.`);
            return environments.map(environment => ({
              name: `${environment.title || environment.id} (${environment.id})` +
                (environment.status ? ` [${environment.status}]` : ''),
              value: environment.id,
            }));
          },
        },
      },
    },
  };
};
