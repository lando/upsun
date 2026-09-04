'use strict';

const upsun = require('../upsun/builder');

// Deprecated recipe alias. Same Fixed implementation as `upsun`.
module.exports = Object.assign({}, upsun, {name: 'platformsh'});
