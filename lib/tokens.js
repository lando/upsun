'use strict';

const utils = require('./utils');

// Write new cache; still read the pre-rename Platform.sh cache so existing users keep working.
const TOKEN_CACHE = 'upsun.tokens';
const LEGACY_TOKEN_CACHE = 'platformsh.tokens';

/**
 * Merge legacy `platformsh.tokens` with `upsun.tokens` (read-old).
 *
 * @param {object} lando Lando instance with cache.
 * @returns {Array}
 */
exports.readTokens = lando => utils.sortTokens(
  lando.cache.get(LEGACY_TOKEN_CACHE) || [],
  lando.cache.get(TOKEN_CACHE) || []
);

/**
 * Persist tokens to `upsun.tokens` only (write-new).
 *
 * @param {object} lando Lando instance with cache.
 * @param {Array} tokens Token entries.
 */
exports.writeTokens = (lando, tokens) => {
  lando.cache.set(TOKEN_CACHE, tokens, {persist: true});
};

exports.TOKEN_CACHE = TOKEN_CACHE;
exports.LEGACY_TOKEN_CACHE = LEGACY_TOKEN_CACHE;
