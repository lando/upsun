'use strict';

const chai = require('chai');
chai.should();
const {getAuthOptions} = require('../lib/auth');

describe('auth', () => {
  it('uses a cached Upsun Fixed token non-interactively', () => {
    const options = getAuthOptions({email: 'dev@example.com', token: 'abc'}, []);
    options.auth.default.should.equal('abc');
    options.auth.defaultDescription.should.equal('dev@example.com');
    options.auth.string.should.equal(true);
  });

  it('prompts for a vendor-neutral Upsun token when none are cached', () => {
    const options = getAuthOptions({}, []);
    options.auth.string.should.equal(true);
    options['api-token'].interactive.message.should.equal('Enter an Upsun API token');
  });

  it('keeps cached token choices in order with the refresh sentinel last', () => {
    const options = getAuthOptions({}, [
      {email: 'second@example.com', token: 'second'},
      {email: 'first@example.com', token: 'first'},
    ]);
    options.auth.should.include({passthrough: true, string: true});
    options.auth.interactive.weight.should.equal(100);
    options.auth.interactive.choices.should.deep.equal([
      {name: 'second@example.com', value: 'second'},
      {name: 'first@example.com', value: 'first'},
      {name: 'add or refresh a token', value: 'more'},
    ]);
    options['api-token'].hidden.should.equal(true);
    options['api-token'].interactive.should.include({
      name: 'auth',
      type: 'password',
      message: 'Enter an Upsun API token',
      weight: 101,
    });
  });

  it('only requests a new token for the refresh choice when tokens are cached', () => {
    const options = getAuthOptions({}, [{email: 'dev@example.com', token: 'abc'}]);
    for (const answers of [{auth: 'abc'}, {auth: 'more'}, {}, {auth: null}, undefined, null]) {
      options.auth.interactive.when(answers).should.equal(true);
      options['api-token'].interactive.when(answers).should.equal(answers?.auth === 'more');
    }
  });

  it('always requests a token and skips selection for empty or omitted token lists', () => {
    for (const options of [getAuthOptions({}, []), getAuthOptions()]) {
      options.auth.interactive.choices.should.deep.equal([
        {name: 'add or refresh a token', value: 'more'},
      ]);
      for (const answers of [{auth: 'abc'}, {auth: 'more'}, {}, undefined, null]) {
        options.auth.interactive.when(answers).should.equal(false);
        options['api-token'].interactive.when(answers).should.equal(true);
      }
    }
  });
});
