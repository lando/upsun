'use strict';

const {RUNTIME_TYPES} = require('./lib/mapping/runtimes');
const utils = require('./lib/utils');

const APP_TYPES = new Set(Object.values(RUNTIME_TYPES));

module.exports = lando => {
  lando.log.alsoSanitize('upsun-auth');
  lando.log.alsoSanitize('platformsh-auth');

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
