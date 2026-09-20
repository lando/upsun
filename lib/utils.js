'use strict';

const _ = require('lodash');

/**
 * Whether a Landofile recipe name belongs to this plugin.
 *
 * @param {string} recipe Recipe name from the Landofile.
 * @returns {boolean} True for `upsun` and the deprecated `platformsh` alias.
 */
exports.isUpsunRecipe = recipe => recipe === 'upsun' || recipe === 'platformsh';

/**
 * Merge token lists keeping the most recent token per email.
 *
 * @param {...Array} sources Token entry arrays (`{email, token, date}`).
 * @returns {Array} Deduplicated tokens sorted by date.
 */
exports.sortTokens = (...sources) => _(_.flatten([...sources]))
    .sortBy('date')
    .groupBy('email')
    .map(tokens => _.last(tokens))
    .sortBy('date')
    .value();
