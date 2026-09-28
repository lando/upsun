'use strict';

/** @type {Record<import('./config/config.types').UpsunFlavor, import('./mapping/mapping.types').CliMeta>} */
const CLIS = {
  flex: {
    binary: 'upsun',
    tokenVar: 'UPSUN_CLI_TOKEN',
    home: '~/.upsun-cli',
    vendor: 'upsun',
  },
  fixed: {
    binary: 'platform',
    tokenVar: 'PLATFORMSH_CLI_TOKEN',
    home: '~/.platformsh',
    vendor: 'platformsh',
  },
};

exports.API_CONFIG = Object.freeze({
  api_url: 'https://api.upsun.com',
  authentication_url: 'https://auth.upsun.com',
});

/**
 * Resolve the CLI contract for an Upsun configuration flavor.
 *
 * @param {import('./config/config.types').UpsunFlavor} flavor Configuration flavor.
 * @param {object} context Resolution context reserved for callers.
 * @param {Record<string, string|undefined>} [context.env] Host environment.
 * @param {object} [context.landofile] Parsed Landofile.
 * @returns {import('./mapping/mapping.types').CliMeta} CLI metadata.
 */
exports.resolveCli = (flavor, {env = {}, landofile = {}} = {}) => {
  void env;
  void landofile;
  if (!CLIS[flavor]) throw new Error(`Unsupported Upsun CLI flavor: ${flavor}`);
  return {...CLIS[flavor]};
};

/**
 * Build the environment passed to CLI tooling inside an app service.
 *
 * @param {import('./config/config.types').UpsunFlavor} flavor Configuration flavor.
 * @param {object} values Tooling values.
 * @param {string} [values.token] API token.
 * @param {string} [values.projectId] Remote project ID.
 * @param {string} [values.environment] Remote environment ID.
 * @returns {Record<string, string>} Tooling environment.
 */
exports.getCliEnv = (flavor, {token, projectId, environment} = {}) => {
  const cli = exports.resolveCli(flavor);
  const result = {
    [`${cli.vendor.toUpperCase()}_CLI_NO_INTERACTION`]: '1',
    [`${cli.vendor.toUpperCase()}_CLI_UPDATES_CHECK`]: '0',
    UPSUN_CLI_CONTEXT: '1',
    PLATFORM_RELATIONSHIPS: '',
    PLATFORM_APPLICATION: '',
  };
  // Lando stringifies env values, so an unset token would reach the CLI as the literal "undefined"
  if (token) result[cli.tokenVar] = token;
  if (projectId) result.PLATFORM_PROJECT = projectId;
  if (environment) result.PLATFORM_ENVIRONMENT = environment;
  return result;
};

/**
 * Return a build step that installs the selected CLI into /usr/local/bin.
 *
 * Runs as root (`build_as_root`) so the binary lands on every user's PATH.
 *
 * @param {import('./config/config.types').UpsunFlavor} flavor Configuration flavor.
 * @returns {string} Build step.
 */
exports.getInstallStep = flavor => `/helpers/upsun-install-cli.sh ${exports.resolveCli(flavor).binary}`;
