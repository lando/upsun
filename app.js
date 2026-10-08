'use strict';

const _ = require('lodash');
const {getAccountInfo} = require('./lib/api');
const {clearToolingCaches, forCache, selectRoute} = require('./lib/tooling-router');
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

  // Surface anything the recipe builder could not emulate faithfully.
  app.events.on('post-init', () => {
    _.forEach(_.get(app, 'upsun.warnings', []), warning => app.addWarning(warnings.toLandoWarning(warning)));
  });
  // Before core builds app.tasks at post-init 5, so a cold run uses the cwd route.
  app.events.on('post-init', 4, () => {
    const routes = _.get(app, 'upsun.toolingRouter');
    if (!Array.isArray(routes) || routes.length === 0) return;
    const selected = selectRoute(routes);
    if (!selected) return;
    // Unlike warm get-tasks, core get-tooling-tasks turns false entries into tasks.
    app.config.tooling = _.pickBy({...app.config.tooling, ...selected.tooling}, _.isObject);
  });
  // Core reads this with a double JSON.parse and merges it over Landofile tooling on the warm path.
  app.events.on('post-init', 9, () => {
    const routes = _.get(app, 'upsun.toolingRouter');
    if (!Array.isArray(routes)) return;
    lando.cache.set(`${app.name}.tooling.router`, forCache(routes), {persist: true});
  });
  app.events.on('post-uninstall', () => {
    lando.cache.remove(`${app.name}.tooling.router`);
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
        'Mounts, database users or deploy/post_deploy hooks did not complete.',
        'Check the output above, fix the cause, and run:',
      ],
      command: 'lando restart',
    }, error));
  });

  // The closest app is the primary service (lando ssh default), not whichever v3 service came first.
  // Lando computes _defaultService after post-init and bakes it into the ssh task default on `ready` @1,
  // so this must run before that.
  // An unsupported runtime maps to no service, so only point at the closest app when it exists.
  app.events.on('ready', 0, () => {
    const closestApp = _.get(app, 'upsun.closestApp');
    if (closestApp && _.includes(app.services, closestApp)) app._defaultService = closestApp;
  });

  app.events.on('post-auth', async (config, answers = {}) => {
    const token = answers.auth;
    if (!token || token === 'more' || token === 'browser') {
      throw new Error('No API token was provided. Run lando auth upsun again.');
    }
    const vendor = _.get(app, 'upsun.cli.vendor', 'upsun');
    let me;
    try {
      me = await getAccountInfo(token);
    } catch (error) {
      if (![400, 401, 403].includes(error.status)) {
        throw new Error(`Couldn't reach Upsun to check the token: ${error.message}`);
      }
      tokens.removeToken(lando, token, vendor);
      const key = `${app.name}.meta.cache`;
      const meta = lando.cache.get(key);
      if (meta?.token === token) lando.cache.set(key, _.omit(meta, ['token', 'email']), {persist: true});
      clearToolingCaches(lando.cache, app.name);
      throw new Error('Upsun rejected that API token. Run lando auth upsun again to log in.');
    }
    const cache = {token, email: me.mail, date: _.toInteger(_.now() / 1000)};
    tokens.writeTokens(lando, utils.sortTokens(tokens.readTokens(lando, vendor), [cache]), vendor);
    const metaData = lando.cache.get(`${app.name}.meta.cache`);
    lando.cache.set(`${app.name}.meta.cache`, _.merge({}, metaData, cache), {persist: true});
    clearToolingCaches(lando.cache, app.name);
    console.log(`Logged in to Upsun as ${me.mail}.`);
  });

  // Cache a token passed explicitly to lando pull/push once it proves valid
  _.forEach(['pull', 'push', 'switch'], command => {
    app.events.on(`post-${command}`, (config, answers = {}) => {
      if (!answers.auth) return;
      const vendor = _.get(app, 'upsun.cli.vendor', 'upsun');
      return getAccountInfo(answers.auth).then(me => {
        const cache = {token: answers.auth, email: me.mail, date: _.toInteger(_.now() / 1000)};
        tokens.writeTokens(lando, utils.sortTokens(tokens.readTokens(lando, vendor), [cache]), vendor);
        const metaData = lando.cache.get(`${app.name}.meta.cache`);
        lando.cache.set(`${app.name}.meta.cache`, _.merge({}, metaData, cache), {persist: true});
        clearToolingCaches(lando.cache, app.name);
      }).catch(error => {
        if ([400, 401, 403].includes(error.status)) {
          tokens.removeToken(lando, answers.auth, vendor);
          const key = `${app.name}.meta.cache`;
          const meta = lando.cache.get(key);
          if (meta?.token === answers.auth) lando.cache.set(key, _.omit(meta, ['token', 'email']), {persist: true});
          clearToolingCaches(lando.cache, app.name);
          app.log.warn('Upsun rejected the API token; it has been removed. Run lando auth upsun again to log in.');
          return;
        }
        app.log.warn('could not refresh the Upsun account cache: %s', error.message);
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
