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
      {name: 'Paste an API token', value: 'more'},
    ]);
    options['api-token'].hidden.should.equal(true);
    options['api-token'].interactive.should.include({
      name: 'auth',
      type: 'password',
      message: 'Enter an Upsun API token',
      weight: 102,
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
        {name: 'Paste an API token', value: 'more'},
      ]);
      for (const answers of [{auth: 'abc'}, {auth: 'more'}, {}, undefined, null]) {
        options.auth.interactive.when(answers).should.equal(false);
        options['api-token'].interactive.when(answers).should.equal(true);
      }
    }
  });

  it('offers browser login before pasting when no accounts are cached', () => {
    const options = getAuthOptions({}, [], async () => 'created');
    options.auth.interactive.when({}).should.equal(true);
    options.auth.interactive.choices.should.eql([
      {name: 'Log in with your browser', value: 'browser'}, {name: 'Paste an API token', value: 'more'},
    ]);
    options['api-token'].interactive.when({}).should.equal(false);
    options['api-token'].interactive.when({auth: 'more'}).should.equal(true);
    options['browser-login'].hidden.should.equal(true);
    options['browser-login'].interactive.should.include({name: 'auth', weight: 101});
  });

  for (const result of ['created', undefined]) {
    it(`routes browser login to ${result ? 'the created token' : 'pasting'} when selected`, async () => {
      const options = getAuthOptions({}, [], async () => result);
      const answers = {auth: 'browser'};
      (await options['browser-login'].interactive.when(answers)).should.equal(false);
      answers.auth.should.equal(result || 'more');
      options['api-token'].interactive.when(answers).should.equal(!result);
    });
  }

  it('does not call browser login when another account or paste is selected', async () => {
    let calls = 0;
    const options = getAuthOptions({}, [{email: 'dev@example.com', token: 'cached'}], async () => {
      calls++;
      return 'created';
    });
    options.auth.interactive.choices[0].value.should.equal('cached');
    for (const auth of ['cached', 'more', undefined]) {
      const answers = {auth};
      (await options['browser-login'].interactive.when(answers)).should.equal(false);
      chai.expect(answers.auth).to.equal(auth);
    }
    calls.should.equal(0);
  });

  it('keeps cached-account authentication non-interactive even with a login callback', () => {
    const options = getAuthOptions({email: 'dev@example.com', token: 'cached'}, [], async () => 'created');
    options.should.have.all.keys('auth');
    options.auth.default.should.equal('cached');
  });

  it('describes the auth option for both cached and interactive accounts', () => {
    getAuthOptions({email: 'dev@example.com', token: 'abc'}, []).auth.describe
      .should.equal('Upsun API token');
    getAuthOptions({}, []).auth.describe.should.equal('Upsun API token');
  });
});
