'use strict';

const _ = require('lodash');
const {getAccountInfo} = require('../lib/api');
const cli = require('../lib/cli');
const {readLocalProjectId} = require('../lib/project');
const tokens = require('../lib/tokens');
const utils = require('../lib/utils');

let cachedProjects = [];

/**
 * Accept both --upsun-* and deprecated --platformsh-* flags.
 *
 * @param {object} answers Init answers or options.
 * @returns {object} The same object with both flag families populated.
 */
const normalizeInitOptions = answers => {
  answers['upsun-auth'] = answers['upsun-auth'] || answers['platformsh-auth'];
  answers['platformsh-auth'] = answers['upsun-auth'];
  answers['upsun-site'] = answers['upsun-site'] || answers['platformsh-site'];
  answers['platformsh-site'] = answers['upsun-site'];
  return answers;
};

const getFlavor = answers => answers.source === 'platformsh' ? 'fixed' : 'flex';
const isRemoteSource = answers => ['upsun', 'platformsh'].includes(answers.source);

const getTokenChoices = cached => _(cached)
    .map(token => ({name: token.email, value: token.token}))
    .thru(list => list.concat([{name: 'add or refresh a token', value: 'more'}]))
    .value();

const showTokenList = (answers, cached) => isRemoteSource(answers) &&
  utils.isUpsunRecipe(answers.recipe) && !_.isEmpty(cached);
const showTokenEntry = (answers, cached) => isRemoteSource(answers) && utils.isUpsunRecipe(answers.recipe) &&
  (_.isEmpty(cached) || answers['upsun-auth'] === 'more');

const getProjects = (answers, lando, input = null) => {
  normalizeInitOptions(answers);
  if (!_.isEmpty(cachedProjects)) {
    return lando.Promise.resolve(cachedProjects).filter(project => _.startsWith(project.name, input));
  }
  return getAccountInfo(_.trim(answers['upsun-auth']))
      .then(me => {
        cachedProjects = _.map(me.projects, project => ({name: project.title, value: project.name}));
        return cachedProjects;
      })
      .catch(err => lando.Promise.reject(Error(_.get(err, 'error_description', err.message || err))));
};

module.exports = {
  name: 'upsun',
  options: lando => ({
    'upsun-auth': {
      describe: 'An Upsun API token',
      string: true,
      interactive: {
        type: 'list',
        choices: getTokenChoices(tokens.readTokens(lando)),
        message: 'Select an Upsun account',
        when: answers => showTokenList(answers, tokens.readTokens(lando)),
        weight: 510,
      },
    },
    'upsun-auth-token': {
      hidden: true,
      interactive: {
        name: 'upsun-auth',
        type: 'password',
        message: 'Enter an Upsun API token',
        when: answers => showTokenEntry(answers, tokens.readTokens(lando)),
        weight: 520,
      },
    },
    'upsun-site': {
      describe: 'An Upsun project name',
      string: true,
      interactive: {
        type: 'autocomplete',
        message: 'Which project?',
        source: (answers, input) => getProjects(answers, lando, input)
            .then(projects => _.orderBy(projects, ['name'], ['asc'])),
        when: answers => isRemoteSource(answers) && utils.isUpsunRecipe(answers.recipe),
        weight: 530,
      },
    },
    'platformsh-auth': {describe: 'Deprecated alias for --upsun-auth', string: true},
    'platformsh-site': {describe: 'Deprecated alias for --upsun-site', string: true},
  }),
  overrides: {
    name: {
      when: answers => {
        normalizeInitOptions(answers);
        if (isRemoteSource(answers)) {
          answers.name = answers['upsun-site'];
          return false;
        }
        return _.isEmpty(answers.name);
      },
    },
    webroot: {when: () => false},
  },
  sources: [{
    name: 'upsun',
    label: 'upsun',
    overrides: {recipe: {when: answers => {
      answers.recipe = 'upsun';
      return false;
    }}},
    build: options => {
      normalizeInitOptions(options);
      const flavor = getFlavor(options);
      const {binary} = cli.resolveCli(flavor);
      return [{
        name: 'get-project-id',
        func: (opts, lando) => {
          return getAccountInfo(_.trim(opts['upsun-auth'])).then(me => {
            const project = _.find(me.projects, {name: opts['upsun-site']});
            if (_.isEmpty(project)) throw Error(`${opts['upsun-site']} does not appear to be an Upsun project!`);
            opts['upsun-project-id'] = project.id;
            lando.log.verbose('Resolved %s to project %s', opts['upsun-site'], project.id);
          });
        },
      }, {
        name: 'clone-repo',
        image: 'node:20-bookworm',
        // Lando's init runner only forwards cmd/user/remove from a step, so the CLI env has to
        // ride along on the command itself. It runs through /bin/sh -c, so VAR=value prefixes work.
        cmd: opts => {
          const env = cli.getCliEnv(flavor, {token: _.trim(opts['upsun-auth'])});
          const prefix = _.map(env, (value, key) => `${key}=${value}`).join(' ');
          return `${cli.getInstallStep(flavor)} && ${prefix} ${binary} get ${opts['upsun-project-id']} /app`;
        },
        remove: 'true',
      }];
    },
  }, {
    name: 'platformsh',
    label: 'platformsh (Upsun Fixed)',
    overrides: {recipe: {when: answers => {
      answers.recipe = 'upsun';
      return false;
    }}},
    build: options => module.exports.sources[0].build(_.merge(options, {source: 'platformsh'})),
  }],
  build: (options, lando) => {
    normalizeInitOptions(options);
    if (!isRemoteSource(options)) {
      const id = readLocalProjectId(options.destination || process.cwd());
      return id ? {config: {id}} : {};
    }
    const vendor = cli.resolveCli(getFlavor(options)).vendor;
    return getAccountInfo(_.trim(options['upsun-auth'])).then(me => {
      const project = _.find(me.projects, {name: options['upsun-site']});
      if (_.isEmpty(project)) throw Error(`${options['upsun-site']} does not appear to be an Upsun project!`);

      const cache = {token: options['upsun-auth'], email: me.mail, date: _.toInteger(_.now() / 1000)};
      tokens.writeTokens(lando, utils.sortTokens(tokens.readTokens(lando, vendor), [cache]), vendor);
      const metaData = lando.cache.get(`${options.name}.meta.cache`);
      lando.cache.set(`${options.name}.meta.cache`, _.merge({}, metaData, cache), {persist: true});

      return {config: {id: _.get(project, 'id', 'lando')}};
    });
  },
};
