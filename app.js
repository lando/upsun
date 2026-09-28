'use strict';

const _ = require('lodash');
const {getAccountInfo} = require('./lib/api');
const tokens = require('./lib/tokens');
const utils = require('./lib/utils');
const warnings = require('./lib/warnings');

const appHook = (app, lando) => {
  if (!utils.isUpsunRecipe(_.get(app, 'config.recipe'))) return;

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

  // Core normalizes proxy entries at pre-start @1. Its wildcard HostRegexp is longer
  // than an exact host rule, so Traefik's default rule-length priority picks the wildcard.
  app.events.on('pre-start', 3, () => {
    const routes = Object.entries(app.config.proxy || {}).flatMap(([service, entries]) =>
      entries.filter(entry => entry.id).map(entry => ({...entry, service})));
    if (!routes.some(route => route.hostname.includes('*'))) return;
    routes.sort((a, b) => Number(!a.hostname.includes('*')) - Number(!b.hostname.includes('*')) ||
      a.hostname.replace(/\*/g, '').length - b.hostname.replace(/\*/g, '').length ||
      a.pathname.length - b.pathname.length);
    const services = {};
    routes.forEach((route, index) => {
      const labels = (services[route.service] ||= {labels: {}}).labels;
      for (const suffix of ['', '-secured']) {
        labels[`traefik.http.routers.${route.id}${suffix}.priority`] = String(index + 1);
      }
    });
    app.add(new app.ComposeService('upsun-proxy-priorities', {}, {services}));
    app.compose = lando.utils.dumpComposeData(app.composeData, app._dir);
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
      return getAccountInfo(answers.auth).then(me => {
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
 * @returns {import('./lib/mapping/mapping.types').EngineRunCommand[]} Engine run commands.
 */
function buildRunCommands(app) {
  const meUser = service => _.find(app.info || [], {service})?.meUser || 'www-data';
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
