'use strict';

const chai = require('chai');
chai.should();
const utils = require('../lib/utils');

describe('utils', () => {
  it('groups emails case-insensitively and preserves distinct tokens without emails', () => {
    utils.sortTokens([{email: 'A@B.C', token: 'old', date: 1}, {email: 'a@b.c', token: 'new', date: 2},
      {token: 'one', date: 3}, {token: 'two', date: 4}, {token: 'one', date: 5}])
      .map(entry => entry.token).should.eql(['new', 'two', 'one']);
  });

  it('encodes warning codes in documentation fragments', () => {
    const {toLandoWarning} = require('../lib/warnings');
    toLandoWarning({code: 'custom code/#', message: 'warning'}).url.should
      .equal('https://docs.lando.dev/upsun/config.html#custom%20code%2F%23');
  });

  it('treats upsun and platformsh as the same recipe', () => {
    utils.isUpsunRecipe('upsun').should.equal(true);
    utils.isUpsunRecipe('platformsh').should.equal(true);
    utils.isUpsunRecipe('lamp').should.equal(false);
  });

  it('keeps the newest token per email', () => {
    const tokens = utils.sortTokens(
        [{email: 'a@b.c', token: 'old', date: 1}],
        [{email: 'a@b.c', token: 'new', date: 2}, {email: 'x@y.z', token: 'x', date: 1}],
    );
    tokens.map(token => token.token).should.eql(['x', 'new']);
  });
});
