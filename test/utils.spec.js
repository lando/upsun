'use strict';

const chai = require('chai');
chai.should();
const utils = require('../lib/utils');

describe('utils', () => {
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
