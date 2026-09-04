'use strict';

const init = require('../upsun/init');

// Deprecated init alias. Same Fixed flags + platformsh-client flow as `upsun`.
module.exports = Object.assign({}, init, {name: 'platformsh'});
