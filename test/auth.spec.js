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
});
