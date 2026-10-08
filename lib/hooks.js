'use strict';

const path = require('path');
const {shellQuote} = require('./shell');

/**
 * Build the command that creates an application's mount directories.
 *
 * @param {object} app Model application.
 * @param {object} mounts Mount definitions keyed by container path.
 * @returns {string[]} Mount creation commands.
 */
function getMountCommands(app, mounts = app.mounts) {
  const paths = Object.keys(mounts || {})
      .map(mount => shellQuote(path.posix.join('/app', app.sourceRoot, mount)));
  return paths.length === 0 ? [] : [`mkdir -p ${paths.join(' ')}`];
}

/**
 * Build the commands that run whenever an application service starts.
 *
 * @param {object} model Normalized Upsun model.
 * @param {string} appName Application name.
 * @param {object} opts Command role and service options (`role`, `worker`, `databases`).
 * @returns {import('./mapping/mapping.types').StartCommand[]} Ordered start commands.
 */
function getStartCommands(model, appName, opts = {}) {
  const app = model.applications[appName];
  if (!app) throw new Error(`Unknown Upsun application: ${appName}`);

  const role = opts.role || 'app';
  const worker = app.workers?.[opts.worker];
  const mounts = role === 'worker' ? {...app.mounts, ...worker?.mounts} : app.mounts;
  /** @type {import('./mapping/mapping.types').StartCommand[]} */
  const commands = getMountCommands(app, mounts)
      .map(cmd => ({name: 'mounts', cmd, user: 'app'}));
  if (role !== 'app') return commands;

  for (const database of opts.databases || []) {
    const sql = Buffer.from(database.statements.join('\n')).toString('base64');
    commands.push({
      name: `db-init:${database.service}`,
      cmd: `/helpers/upsun-db-init.sh ${database.host} ${database.dialect} ${sql}`,
      user: 'app',
    });
  }

  commands.push({
    name: 'provisioned',
    cmd: 'touch "${UPSUN_PROVISIONED_FILE:-/dev/shm/upsun-provisioned}"',
    user: 'app',
  });
  if (app.type.runtime === 'php' && app.web.commands.pre_start) {
    commands.push({name: 'pre_start', cmd: '/helpers/upsun-hook.sh pre_start', user: 'app'});
  }
  if (app.web.commands.post_start) {
    commands.push({name: 'post_start', cmd: '/helpers/upsun-hook.sh post_start', user: 'app'});
  }
  if (app.hooks.deploy) {
    commands.push({name: 'deploy', cmd: '/helpers/upsun-hook.sh deploy', user: 'app'});
  }
  if (app.hooks.post_deploy) {
    commands.push({name: 'post_deploy', cmd: '/helpers/upsun-hook.sh post_deploy', user: 'app'});
  }

  return commands;
}

module.exports = {getMountCommands, getStartCommands};
