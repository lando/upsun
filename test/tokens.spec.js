'use strict';

const chai = require('chai');
chai.should();
const tokens = require('../lib/tokens');

const makeCache = store => ({
  get: key => store[key],
  set: (key, value) => {
    store[key] = value;
  },
});

describe('token cache read-old-write-new', () => {
  it('reads and merges platformsh.tokens with upsun.tokens', () => {
    const store = {
      'platformsh.tokens': [{email: 'old@example.com', token: 'old', date: 1}],
      'upsun.tokens': [{email: 'new@example.com', token: 'new', date: 2}],
    };
    const result = tokens.readTokens({cache: makeCache(store)}, 'upsun');
    result.should.have.length(2);
    result.map(item => item.email).should.include.members(['old@example.com', 'new@example.com']);
  });

  it('prefers the newer token when the same email exists in both caches', () => {
    const store = {
      'platformsh.tokens': [{email: 'same@example.com', token: 'legacy', date: 10}],
      'upsun.tokens': [{email: 'same@example.com', token: 'fresh', date: 20}],
    };
    const result = tokens.readTokens({cache: makeCache(store)}, 'upsun');
    result.should.have.length(1);
    result[0].token.should.equal('fresh');
  });

  it('writes only to upsun.tokens', () => {
    const store = {
      'platformsh.tokens': [{email: 'old@example.com', token: 'old', date: 1}],
    };
    const cache = makeCache(store);
    tokens.writeTokens({cache}, [{email: 'new@example.com', token: 'new', date: 3}], 'upsun');
    store['upsun.tokens'].should.eql([{email: 'new@example.com', token: 'new', date: 3}]);
    store['platformsh.tokens'].should.eql([{email: 'old@example.com', token: 'old', date: 1}]);
  });

  it('keeps Fixed tokens in the platformsh vendor cache', () => {
    const store = {'platformsh.tokens': [{email: 'fixed@example.com', token: 'fixed', date: 1}]};
    const cache = makeCache(store);
    tokens.readTokens({cache}, 'platformsh').should.eql(store['platformsh.tokens']);
    tokens.writeTokens({cache}, [{email: 'next@example.com', token: 'next', date: 2}], 'platformsh');
    store['platformsh.tokens'].should.eql([{email: 'next@example.com', token: 'next', date: 2}]);
  });
});
