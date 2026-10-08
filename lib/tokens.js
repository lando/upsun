'use strict';

const fs = require('fs');
const path = require('path');
const {resolveCli} = require('./cli');
const utils = require('./utils');

const TOKEN_CACHE = 'upsun.tokens';
const LEGACY_TOKEN_CACHE = 'platformsh.tokens';
const REJECTED_TOKEN_CACHE = 'upsun.rejected-tokens';

const getCache = vendor => vendor === 'platformsh' ? LEGACY_TOKEN_CACHE : TOKEN_CACHE;

/**
 * Read only the selected vendor cache, excluding legacy and CLI-file imports.
 * @param {object} lando Lando instance with cache.
 * @param {'upsun'|'platformsh'} vendor CLI vendor.
 * @returns {import('./mapping/mapping.types').TokenEntry[]} Cached token entries.
 */
exports.readCachedTokens = (lando, vendor = 'upsun') => lando.cache.get(getCache(vendor)) || [];

/**
 * Merge vendor caches and the CLI's saved token without persisting the result.
 *
 * @param {object} lando Lando instance with cache.
 * @param {'upsun'|'platformsh'} vendor CLI vendor.
 * @returns {import('./mapping/mapping.types').TokenEntry[]} Sorted token entries.
 */
exports.readTokens = (lando, vendor = 'upsun') => {
  const cached = vendor === 'upsun' ? [
    ...(lando.cache.get(LEGACY_TOKEN_CACHE) || []),
    ...(lando.cache.get(TOKEN_CACHE) || []),
  ] : lando.cache.get(getCache(vendor)) || [];
  const cli = exports.readCliTokens(lando.config?.home, vendor)
    .filter(entry => !(lando.cache.get(REJECTED_TOKEN_CACHE) || []).includes(entry.token) &&
      !cached.some(saved => saved.token === entry.token));
  return utils.sortTokens(cached, cli);
};

/**
 * Read the active CLI session's plain-text API token, when available.
 *
 * @param {string} home User home directory.
 * @param {'upsun'|'platformsh'} vendor CLI vendor.
 * @returns {import('./mapping/mapping.types').TokenEntry[]} CLI token entries with a picker label and file modification date.
 */
exports.readCliTokens = (home, vendor = 'upsun') => {
  if (!home) return [];
  const cli = resolveCli(vendor === 'platformsh' ? 'fixed' : 'flex');
  // The CLI stores trimmed plain text in getSessionDir(true)/api-token, not ~/.<cli>/.api-token.
  // https://github.com/platformsh/legacy-cli/blob/2cdfae8ee07a8afde517be7630da87a1a9958d2e/src/ApiToken/FileStorage.php#L50-L84
  // https://github.com/upsun/cli/blob/837566e7670ae8c87048b0aae5846a38d7f62f3d/legacy/src/Service/Config.php#L268-L294
  const cliHome = path.join(home, cli.home.replace(/^~[\\/]/, ''));
  let sessionId = 'default';
  try {
    sessionId = fs.readFileSync(path.join(cliHome, 'session-id'), 'utf8').trim() || 'default';
  } catch {
    // No active session file means the CLI's default session.
  }
  const slug = sessionId.replace(/[^\w-]+/g, '-');
  const filename = path.join(cliHome, '.session', `sess-cli-${slug}`, 'api-token');
  try {
    const token = fs.readFileSync(filename, 'utf8').trim();
    if (!token) return [];
    return [{token, email: `${cli.binary} CLI token`, date: Math.floor(fs.statSync(filename).mtimeMs / 1000)}];
  } catch {
    // CLI file storage is optional: missing or unreadable files must not block Lando authentication.
    return [];
  }
};

/**
 * Persist tokens to `upsun.tokens` only (write-new).
 *
 * @param {object} lando Lando instance with cache.
 * @param {import('./mapping/mapping.types').TokenEntry[]} tokens Token entries.
 * @param {'upsun'|'platformsh'} vendor CLI vendor.
 * @returns {void}
 */
exports.writeTokens = (lando, tokens, vendor = 'upsun') => {
  lando.cache.set(getCache(vendor), tokens, {persist: true});
  const rejected = lando.cache.get(REJECTED_TOKEN_CACHE);
  if (rejected) {
    lando.cache.set(REJECTED_TOKEN_CACHE,
        rejected.filter(token => !tokens.some(entry => entry.token === token)), {persist: true});
  }
};

/**
 * Remove a rejected token from the vendor cache and any merged legacy cache.
 *
 * @param {object} lando Lando instance with cache.
 * @param {string} token API token to remove.
 * @param {'upsun'|'platformsh'} vendor CLI vendor.
 * @returns {void}
 */
exports.removeToken = (lando, token, vendor = 'upsun') => {
  /** @type {import('./mapping/mapping.types').CliMeta['vendor'][]} */
  const vendors = vendor === 'upsun' ? ['upsun', 'platformsh'] : [vendor];
  for (const source of vendors) {
    const entries = lando.cache.get(getCache(source)) || [];
    exports.writeTokens(lando, entries.filter(entry => entry.token !== token), source);
  }
  lando.cache.set(REJECTED_TOKEN_CACHE,
      [...new Set([...(lando.cache.get(REJECTED_TOKEN_CACHE) || []), token])], {persist: true});
};
