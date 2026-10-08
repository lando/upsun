'use strict';

const _ = require('lodash');
const {getAccountInfo} = require('../lib/api');
const cli = require('../lib/cli');
const {detect} = require('../lib/config/detect');
const login = require('../lib/login');
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
const getTokenVendor = answers => {
  try {
    return detect(answers.destination || process.cwd()).flavor === 'fixed' ? 'platformsh' : 'upsun';
  } catch {
    return cli.resolveCli(getFlavor(answers)).vendor;
  }
};
// Upsun, Fixed or Magento config (including mixed config) means an existing checkout; unexpected errors propagate.
const hasUpsunProject = root => {
  try {
    return Boolean(detect(root));
  } catch (error) {
    if (error.code === 'UPSUN_MIXED_CONFIG') return true;
    if (error.code === 'UPSUN_NO_CONFIG') return false;
    throw error;
  }
};
const isRemoteSource = answers => ['upsun', 'platformsh'].includes(answers.source);

const getTokenChoices = cached => _(cached)
    .map(token => ({name: token.email, value: token.token}))
    .thru(list => list.concat([{name: 'Log in with your browser', value: 'browser'},
      {name: 'Paste an API token', value: 'more'}]))
    .value();

const showTokenList = answers => isRemoteSource(answers) && utils.isUpsunRecipe(answers.recipe);
const showTokenEntry = answers => showTokenList(answers) && answers['upsun-auth'] === 'more';

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
        when: answers => showTokenList(answers),
        weight: 510,
      },
    },
    'upsun-auth-browser': {
      hidden: true,
      interactive: {
        name: 'upsun-auth',
        weight: 515,
        when: async answers => {
          if (showTokenList(answers) && answers['upsun-auth'] === 'browser') {
            answers['upsun-auth'] = await login.promptBrowserLogin({lando,
              vendor: getTokenVendor(answers)}) || 'more';
          }
          return false;
        },
      },
    },
    'upsun-auth-token': {
      hidden: true,
      interactive: {
        name: 'upsun-auth',
        type: 'password',
        message: 'Enter an Upsun API token',
        when: answers => showTokenEntry(answers),
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
      const destination = options.destination || process.cwd();
      // Already in a checkout: keep the account and project prompts for config.id and the token, skip the clone
      const existing = hasUpsunProject(destination);
      const getProjectId = {
        name: 'get-project-id',
        func: (opts, lando) => {
          return getAccountInfo(_.trim(opts['upsun-auth'])).then(me => {
            const project = _.find(me.projects, {name: opts['upsun-site']});
            if (_.isEmpty(project)) throw Error(`${opts['upsun-site']} does not appear to be an Upsun project!`);
            opts['upsun-project-id'] = project.id;
            lando.log.verbose('Resolved %s to project %s', opts['upsun-site'], project.id);
            if (!existing) return;
            const linked = readLocalProjectId(destination);
            if (linked && linked !== project.id) {
              throw Error(`${destination} is linked to Upsun project ${linked}, not ${opts['upsun-site']} ` +
                `(${project.id}). Choose that project, or run lando init --source cwd.`);
            }
            console.log(`Found an Upsun project in ${destination}; skipping the clone.`);
          });
        },
      };
      if (existing) return [getProjectId];
      return [getProjectId, {
        name: 'clone-repo',
        // Lando's init runner only forwards cmd/user/remove from a step, so the CLI env has to
        // ride along on the command itself. It runs through /bin/sh -c, so VAR=value prefixes work.
        cmd: opts => {
          const quote = value => `'${String(value).replace(/'/g, '\'\\\'\'')}'`;
          const env = cli.getCliEnv(flavor, {token: _.trim(opts['upsun-auth'])});
          const prefix = _.map(env, (value, key) => `${key}=${quote(value)}`).join(' ');
          // /app is the bind-mounted destination, so it always exists and `get` refuses it. Clone beside it
          // and copy the checkout in, like core's remote git source, without clobbering an existing repo.
          const guard = '{ test ! -e /app/.git || { echo "The destination already has a git repository; ' +
            'run lando init in a folder without .git." >&2; exit 1; }; }';
          return `${guard} && ${cli.getInstallStep(flavor)} && rm -rf /tmp/upsun-get && ` +
            `${prefix} ${binary} get ${quote(opts['upsun-project-id'])} /tmp/upsun-get && cp -rfT /tmp/upsun-get /app`;
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
    const vendor = getTokenVendor(options);
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
