'use strict';

const shellQuote = value => `'${String(value).replace(/'/g, '\'\\\'\'')}'`;
const shellArgument = value => /^(?!-)[A-Za-z0-9_./:@=^+-]+$/.test(String(value)) ? String(value) : shellQuote(value);

module.exports = {shellQuote, shellArgument};
