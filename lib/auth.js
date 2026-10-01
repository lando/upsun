'use strict';

const getInteractiveOptions = (tokens = [], login) => ({
  'auth': {
    passthrough: true,
    string: true,
    interactive: {
      type: 'list',
      message: 'Select an Upsun account',
      choices: [...tokens.map(token => ({name: token.email, value: token.token})),
        ...(login ? [{name: 'Log in with your browser', value: 'browser'}] : []),
        {name: 'Paste an API token', value: 'more'}],
      when: () => Boolean(login) || tokens.length > 0,
      weight: 100,
    },
  },
  ...(login ? {'browser-login': {
    hidden: true,
    interactive: {
      name: 'auth',
      weight: 101,
      when: async answers => {
        if (answers.auth === 'browser') answers.auth = await login() || 'more';
        return false;
      },
    },
  }} : {}),
  'api-token': {
    hidden: true,
    interactive: {
      name: 'auth',
      type: 'password',
      message: 'Enter an Upsun API token',
      when: answers => (!login && tokens.length === 0) || answers?.auth === 'more',
      weight: 102,
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
 * @param {function(): Promise<string|undefined>} [login] Browser login callback.
 * @returns {Record<string, import('./mapping/mapping.types').ToolingOption>} Lando tooling options.
 */
exports.getAuthOptions = ({email = false, token = false} = {}, tokens = [], login) => {
  if (email && token) return getNonInteractiveOptions(token, email);
  return getInteractiveOptions(tokens, login);
};
