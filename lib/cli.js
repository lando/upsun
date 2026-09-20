'use strict';

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

/**
 * Resolve the CLI contract for an Upsun configuration flavor.
 *
 * @param {'flex'|'fixed'} flavor Configuration flavor.
 * @param {object} context Resolution context reserved for callers.
 * @param {object} context.env Host environment.
 * @param {object} context.landofile Parsed Landofile.
 * @returns {{binary: string, tokenVar: string, home: string, vendor: string}} CLI metadata.
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
 * @param {'flex'|'fixed'} flavor Configuration flavor.
 * @param {object} values Tooling values.
 * @param {string} [values.token] API token.
 * @param {string} [values.projectId] Remote project ID.
 * @param {string} [values.environment] Remote environment ID.
 * @returns {object} Tooling environment.
 */
exports.getCliEnv = (flavor, {token, projectId, environment} = {}) => {
  const cli = exports.resolveCli(flavor);
  const result = {
    [cli.tokenVar]: token,
    [`${cli.vendor.toUpperCase()}_CLI_NO_INTERACTION`]: '1',
    PLATFORM_RELATIONSHIPS: '',
    PLATFORM_APPLICATION: '',
  };
  if (projectId) result.PLATFORM_PROJECT = projectId;
  if (environment) result.PLATFORM_ENVIRONMENT = environment;
  return result;
};

/**
 * Return a build step that installs the selected CLI into /usr/local/bin.
 *
 * Runs as root (`build_as_root`) so the binary lands on every user's PATH.
 *
 * @param {'flex'|'fixed'} flavor Configuration flavor.
 * @returns {string} Build step.
 */
exports.getInstallStep = flavor => `/helpers/upsun-install-cli.sh ${exports.resolveCli(flavor).binary}`;
