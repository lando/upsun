'use strict';

const getInteractiveOptions = (tokens = []) => ({
  'auth': {
    passthrough: true,
    string: true,
    interactive: {
      choices: [...tokens.map(token => ({name: token.email, value: token.token})),
        {name: 'add or refresh a token', value: 'more'}],
      when: () => tokens.length > 0,
      weight: 100,
    },
  },
  'api-token': {
    hidden: true,
    interactive: {
      name: 'auth',
      type: 'password',
      message: 'Enter an Upsun API token',
      when: answers => tokens.length === 0 || answers?.auth === 'more',
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
 * @param {import('./mapping/mapping.types').TokenEntry[]} tokens Cached token entries.
 * @returns {Record<string, import('./mapping/mapping.types').ToolingOption>} Lando tooling options.
 */
exports.getAuthOptions = ({email = false, token = false} = {}, tokens = []) => {
  if (email && token) return getNonInteractiveOptions(token, email);
  return getInteractiveOptions(tokens);
};
