'use strict';

const {RUNTIME_TYPES} = require('./lib/mapping/runtimes');
const {getAccountInfo} = require('./lib/api');
const {detect} = require('./lib/config/detect');
const tokens = require('./lib/tokens');
const utils = require('./lib/utils');

const APP_TYPES = new Set(Object.values(RUNTIME_TYPES));
const REJECTED_STATUSES = new Set([400, 401, 403]);

/**
 * Register CLI authentication and SSH hooks.
 *
 * @param {object} lando Lando instance.
 * @returns {void}
 */
module.exports = lando => {
  lando.log.alsoSanitize('upsun-auth');
  lando.log.alsoSanitize('platformsh-auth');

  for (const command of ['pull', 'push', 'switch']) {
    lando.events.on(`cli-${command}-answers`, async data => {
      const app = data?.options?._app;
      if (!app || !utils.isUpsunRecipe(app.recipe)) return;
      if (!data.options.auth) return;
      let vendor = app.upsun?.cli?.vendor;
      if (!vendor) {
        try {
          vendor = detect(app.root).flavor === 'fixed' ? 'platformsh' : 'upsun';
        } catch {
          // Cached tooling can run before the builder or without readable project config.
          vendor = 'upsun';
        }
      }
      const cached = tokens.readTokens(lando, vendor).find(entry => entry.token === data.options.auth);
      if (!cached) return;
      try {
        await getAccountInfo(cached.token);
      } catch (error) {
        // Only a rejected token (invalid_grant on exchange, 401/403 on /me) is scrubbed;
        // an outage or offline host must not throw away a good token.
        if (!REJECTED_STATUSES.has(error.status)) return;
        tokens.removeToken(lando, cached.token, vendor);
        const key = `${app.name}.meta.cache`;
        const meta = lando.cache.get(key);
        if (meta?.token === cached.token) {
          const next = {...meta};
          delete next.token;
          delete next.email;
          lando.cache.set(key, next, {persist: true});
        }
        lando.cache.remove(`${app.name}.tooling.cache`);
        delete data.options.auth;
        lando.log.warn('the cached Upsun API token for %s is invalid; it has been removed. ' +
          'Run the command again to enter a new token.', cached.email);
      }
    });
  }

  // lando ssh should behave like an Upsun SSH session: .environment sourced
  lando.events.on('cli-ssh-run', data => {
    const app = data?.options?._app;
    if (!app || !utils.isUpsunRecipe(app.recipe)) return;
    // The task default is a literal "appserver"; send it to the primary (closest app) service instead
    const hasAppserver = (app.info || []).some(service => service.service === 'appserver');
    if (data.options.service === 'appserver' && !hasAppserver && app.primary) {
      data.options.service = app.primary;
      data.options.s = app.primary;
    }
    // Only app containers carry the Upsun environment; the bash wrapper also fails on bash-less images (mailpit)
    const target = (app.info || []).find(service => service.service === data.options.service);
    if (target && !APP_TYPES.has(target.type)) return;
    const command = data.options.command || 'if ! type bash > /dev/null; then sh; else bash; fi';
    data.options.command = ['/helpers/upsun-exec.sh', '/bin/sh', '-c', command];
  });
};
