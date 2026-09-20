'use strict';

const utils = require('./utils');

const TOKEN_CACHE = 'upsun.tokens';
const LEGACY_TOKEN_CACHE = 'platformsh.tokens';

const getCache = vendor => vendor === 'platformsh' ? LEGACY_TOKEN_CACHE : TOKEN_CACHE;

/**
 * Merge legacy `platformsh.tokens` with `upsun.tokens` (read-old).
 *
 * @param {object} lando Lando instance with cache.
 * @param {'upsun'|'platformsh'} vendor CLI vendor.
 * @returns {Array} Sorted token entries.
 */
exports.readTokens = (lando, vendor = 'upsun') => vendor === 'upsun' ? utils.sortTokens(
  lando.cache.get(LEGACY_TOKEN_CACHE) || [],
  lando.cache.get(TOKEN_CACHE) || []
) : utils.sortTokens(lando.cache.get(getCache(vendor)) || []);

/**
 * Persist tokens to `upsun.tokens` only (write-new).
 *
 * @param {object} lando Lando instance with cache.
 * @param {Array} tokens Token entries.
 * @param {'upsun'|'platformsh'} vendor CLI vendor.
 */
exports.writeTokens = (lando, tokens, vendor = 'upsun') => {
  lando.cache.set(getCache(vendor), tokens, {persist: true});
};

exports.TOKEN_CACHE = TOKEN_CACHE;
exports.LEGACY_TOKEN_CACHE = LEGACY_TOKEN_CACHE;
