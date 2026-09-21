'use strict';

const _ = require('lodash');
const PlatformshApiClient = require('platformsh-client').default;
const {API_CONFIG} = require('./lib/cli');
const tokens = require('./lib/tokens');
const utils = require('./lib/utils');
const warnings = require('./lib/warnings');

/*
 * App-level hooks for the upsun recipe.
 */
const appHook = (app, lando) => {
  if (!utils.isUpsunRecipe(_.get(app, 'config.recipe'))) return;

  // Use the Upsun project id as the app id when we have one
  app.id = _.get(app, 'config.config.id', app.id);
  app.log.verbose('identified an upsun app, id %s', app.id);
  app.log.alsoSanitize('upsun-auth');
  app.log.alsoSanitize('platformsh-auth');

  if (app.config.recipe === 'platformsh') {
    app.addWarning(warnings.toLandoWarning({
      code: 'recipe-deprecated-alias',
      message: 'recipe: platformsh is deprecated; use recipe: upsun for both Upsun Flex and Upsun Fixed projects.',
    }));
  }

  // Surface anything the recipe builder could not emulate faithfully
  app.events.on('post-init', () => {
    _.forEach(_.get(app, 'upsun.warnings', []), warning => app.addWarning(warnings.toLandoWarning(warning)));
  });

  app.events.on('post-info', () => {
    if (!_.get(app, 'upsun.tethered')) return;
    const service = _.find(app.info, {service: app.upsun.closestApp});
    if (service) service.tethered = app.upsun.tetherEnvironment;
  });

  app.events.on('post-start', 101, () => {
    const steps = module.exports.buildRunCommands(app);
    if (steps.length === 0) return;
    app.log.info('running upsun start commands (%s)...', steps.map(step => step.opts.upsunStep).join(', '));
    return app.engine.run(steps).catch(error => app.addMessage({
      title: 'One of your Upsun start commands failed',
      type: 'warning',
      detail: [
        'Mounts, database users, deploy/post_deploy hooks or the tether did not complete.',
        'Check the output above, fix the cause, and run:',
      ],
      command: 'lando restart',
    }, error));
  });

  // The closest app is the primary service (lando ssh default), not whichever v3 service came first.
  // Lando computes _defaultService after post-init and bakes it into the ssh task default on `ready` @1,
  // so this must run before that.
  app.events.on('ready', 0, () => {
    if (_.get(app, 'upsun.closestApp')) app._defaultService = app.upsun.closestApp;
  });

  // Cache a token passed explicitly to lando pull/push once it proves valid
  _.forEach(['pull', 'push'], command => {
    app.events.on(`post-${command}`, (config, answers = {}) => {
      if (!answers.auth) return;
      const vendor = _.get(app, 'upsun.cli.vendor', 'upsun');
      const api = new PlatformshApiClient({...API_CONFIG, api_token: answers.auth});
      return api.getAccountInfo().then(me => {
        const cache = {token: answers.auth, email: me.mail, date: _.toInteger(_.now() / 1000)};
        tokens.writeTokens(lando, utils.sortTokens(tokens.readTokens(lando, vendor), [cache]), vendor);
        const metaData = lando.cache.get(`${app.name}.meta.cache`);
        lando.cache.set(`${app.name}.meta.cache`, _.merge({}, metaData, cache), {persist: true});
      });
    });
  });
};

/**
 * Build engine commands for every configured Upsun start command.
 *
 * @param {object} app Lando app.
 * @returns {object[]} Engine run commands.
 */
function buildRunCommands(app) {
  const meUser = service => (_.find(app.info || [], {service}) || {}).meUser || 'www-data';
  return Object.entries(_.get(app, 'upsun.startCommands', {})).flatMap(([service, commands]) => {
    if (!app.containers?.[service]) return [];
    return commands.map(({name, cmd, user, env = {}}) => ({
      id: app.containers[service],
      cmd: ['/helpers/exec-multiliner.sh', Buffer.from(cmd, 'utf8').toString('base64')],
      compose: app.compose,
      project: app.project,
      api: 3,
      opts: {
        mode: 'attach',
        user: user === 'root' ? 'root' : meUser(service),
        services: [service],
        cstdio: 'inherit',
        environment: {...env},
        upsunStep: `${service}:${name}`,
      },
    }));
  });
}

module.exports = appHook;
module.exports.buildRunCommands = buildRunCommands;
