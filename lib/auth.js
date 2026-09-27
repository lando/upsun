'use strict';

const _ = require('lodash');

const getTokens = tokens => _(tokens).map(token => ({name: token.email, value: token.token})).value();

const getInteractiveOptions = (tokens = []) => ({
  'auth': {
    passthrough: true,
    string: true,
    interactive: {
      choices: _.flatten([getTokens(tokens), [{name: 'add or refresh a token', value: 'more'}]]),
      when: () => !_.isEmpty(tokens),
      weight: 100,
    },
  },
  'api-token': {
    hidden: true,
    interactive: {
      name: 'auth',
      type: 'password',
      message: 'Enter an Upsun API token',
      when: answers => _.isEmpty(tokens) || (_.get(answers, 'auth', '') === 'more'),
      weight: 101,
    },
  },
});

const getNonInteractiveOptions = (token, email) => ({
  'auth': {
    default: token,
    defaultDescription: email,
    passthrough: true,
    string: true,
  },
});

/**
 * Build interactive or cached authentication options for tooling.
 *
 * @param {object} account Cached account metadata.
 * @param {string|boolean} [account.email] Account email.
 * @param {string|boolean} [account.token] API token.
 * @param {Array} tokens Cached token entries.
 * @returns {object} Lando tooling options.
 */
exports.getAuthOptions = ({email = false, token = false} = {}, tokens = []) => {
  if (email && token) return getNonInteractiveOptions(token, email);
  return getInteractiveOptions(tokens);
};
