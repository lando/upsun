'use strict';

// Modules
const _ = require('lodash');
const fs = require('fs');
const os = require('os');
const path = require('path');
const utils = require('./../../lib/utils');
const tokens = require('./../../lib/tokens');
const PlatformshApiClient = require('platformsh-client').default;

// Fixed key + CLI semantics stay Platform.sh. Cache writes go to upsun.tokens.
const platformshLandoKey = 'platformsh.lando.id_rsa';
const platformshLandoKeyComment = 'lando@' + os.hostname();
let platformshSites = [];

/**
 * Accept both --upsun-* and deprecated --platformsh-* flags.
 *
 * @param {object} answers Init answers or options.
 * @returns {object}
 */
const normalizeInitOptions = answers => {
  answers['platformsh-auth'] = answers['platformsh-auth'] || answers['upsun-auth'];
  answers['upsun-auth'] = answers['upsun-auth'] || answers['platformsh-auth'];
  answers['platformsh-site'] = answers['platformsh-site'] || answers['upsun-site'];
  answers['upsun-site'] = answers['upsun-site'] || answers['platformsh-site'];
  return answers;
};

// Helper to get tokens
const getTokens = (home, cached = []) => _(utils.sortTokens(utils.getPlatformshTokens(home), cached))
  .map(token => ({name: token.email, value: token.token}))
  .thru(list => list.concat([{name: 'add or refresh a token', value: 'more'}]))
  .value();

// Helper to determine whether to show list of pre-used tokens or not
const showTokenList = (data, cached = []) => utils.isUpsunRecipe(data) && !_.isEmpty(cached);

// Helper to determine whether to show token password entry or not
const showTokenEntry = (data, answer, cached = []) =>
  utils.isUpsunRecipe(data) && (_.isEmpty(cached) || answer === 'more');

// Helper to get sites for autocomplete — KEEP platformsh-client
const getAutoCompleteSites = (answers, lando, input = null) => {
  normalizeInitOptions(answers);
  const api = new PlatformshApiClient({api_token: _.trim(answers['platformsh-auth'])});
  if (!_.isEmpty(platformshSites)) {
    return lando.Promise.resolve(platformshSites).filter(site => _.startsWith(site.name, input));
  } else {
    return api.getAccountInfo().then(me => {
      platformshSites = _.map(me.projects, project => ({name: project.title, value: project.name}));
      return platformshSites;
    })
    .catch(err => lando.Promise.reject(Error(err.error_description)));
  }
};

/*
 * Init upsun (Fixed). --platformsh-* flags remain as deprecated aliases.
 */
module.exports = {
  name: 'upsun',
  options: lando => ({
    'upsun-auth': {
      describe: 'A Platform.sh access token (Fixed)',
      string: true,
      interactive: {
        type: 'list',
        choices: getTokens(lando.config.home, tokens.readTokens(lando)),
        message: 'Select a Platform.sh account',
        when: answers => showTokenList(answers.recipe, tokens.readTokens(lando)),
        weight: 510,
      },
    },
    'upsun-auth-token': {
      hidden: true,
      interactive: {
        name: 'upsun-auth',
        type: 'password',
        message: 'Enter a Platform.sh access token',
        when: answers => showTokenEntry(answers.recipe, answers['upsun-auth'] || answers['platformsh-auth'],
          tokens.readTokens(lando)),
        weight: 520,
      },
    },
    'upsun-site': {
      describe: 'A Fixed project name',
      string: true,
      interactive: {
        type: 'autocomplete',
        message: 'Which project?',
        source: (answers, input) => {
          return getAutoCompleteSites(answers, lando, input).then(sites => {
            return _.orderBy(sites, ['name', 'desc']);
          });
        },
        when: answers => utils.isUpsunRecipe(answers.recipe),
        weight: 530,
      },
    },
    'platformsh-auth': {
      describe: 'Deprecated alias for --upsun-auth',
      string: true,
    },
    'platformsh-auth-token': {
      hidden: true,
    },
    'platformsh-site': {
      describe: 'Deprecated alias for --upsun-site',
      string: true,
    },
    'upsun-key-name': {
      describe: 'A hidden field mostly for easy testing and key removal',
      string: true,
      hidden: true,
      default: 'Landokey',
    },
    'platformsh-key-name': {
      describe: 'Deprecated alias for --upsun-key-name',
      string: true,
      hidden: true,
    },
  }),
  overrides: {
    name: {
      when: answers => {
        normalizeInitOptions(answers);
        answers.name = answers['upsun-site'];
        return false;
      },
    },
    webroot: {
      when: () => false,
    },
  },
  sources: [{
    name: 'upsun',
    label: 'upsun',
    overrides: {
      recipe: {
        when: answers => {
          answers.recipe = 'upsun';
          return false;
        },
      },
    },
    build: (options, lando) => {
      normalizeInitOptions(options);
      // KEEP platformsh-client for account/project/ssh/token
      const api = new PlatformshApiClient({api_token: _.trim(options['platformsh-auth'])});
      return [
        {name: 'generate-key', cmd: `/helpers/generate-key.sh ${platformshLandoKey} ${platformshLandoKeyComment}`},
        {name: 'post-key', func: (opts, landoInst) => {
          normalizeInitOptions(opts);
          const pubKeyPath = path.join(landoInst.config.userConfRoot, 'keys', `${platformshLandoKey}.pub`);
          const pubKeyData = _.trim(fs.readFileSync(pubKeyPath, 'utf8'));
          const keyName = opts['upsun-key-name'] || opts['platformsh-key-name'] || 'Landokey';
          return api.addSshKey(pubKeyData, keyName).catch(err => {
            landoInst.log.verbose('Could not post key %s', keyName, err);
          });
        }},
        {name: 'get-git-url', func: (opts, landoInst) => {
          normalizeInitOptions(opts);
          return api.getAccountInfo()
          .then(me => {
            const project = _.find(me.projects, {name: opts['platformsh-site']});
            return project.id;
          })
          .then(id => api.getProject(id))
          .then(site => api.getAccessToken().then(token => {
            opts['url'] = site.repository.url;
            opts['ssh'] = site.repository.url.split(':')[0];
            opts['token'] = token.access_token;
          }));
        }},
        {name: 'reload-keys', cmd: '/helpers/load-keys.sh --silent', user: 'root'},
        {
          name: 'clone-repo',
          cmd: opts => `/helpers/upsun-clone.sh ${opts['url']} ${opts['ssh']} ${opts['token']}`,
          remove: 'true',
        },
      ];
    },
  }, {
    name: 'platformsh',
    label: 'platformsh',
    overrides: {
      recipe: {
        when: answers => {
          answers.recipe = 'platformsh';
          return false;
        },
      },
    },
    build: (options, lando) => module.exports.sources[0].build(options, lando),
  }],
  build: (options, lando) => {
    normalizeInitOptions(options);
    // KEEP platformsh-client
    const api = new PlatformshApiClient({api_token: _.trim(options['platformsh-auth'])});
    return api.getAccountInfo().then(me => {
      const project = _.find(me.projects, {name: options['platformsh-site']});
      if (_.isEmpty(project)) throw Error(`${options['platformsh-site']} does not appear to be a platform.sh site!`);

      const cache = {token: options['platformsh-auth'], email: me.mail, date: _.toInteger(_.now() / 1000)};
      const existing = tokens.readTokens(lando);
      tokens.writeTokens(lando, utils.sortTokens(existing, [cache]));
      const metaData = lando.cache.get(`${options.name}.meta.cache`);
      lando.cache.set(`${options.name}.meta.cache`, _.merge({}, metaData, cache), {persist: true});

      return {config: {
        id: _.get(project, 'id', 'lando'),
      }};
    });
  },
};
