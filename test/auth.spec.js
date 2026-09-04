'use strict';

const chai = require('chai');
chai.should();
const {getAuthOptions} = require('../lib/auth');

describe('auth', () => {
  it('uses a cached Platform.sh token non-interactively', () => {
    const options = getAuthOptions({email: 'dev@example.com', token: 'abc'}, []);
    options.auth.default.should.equal('abc');
    options.auth.defaultDescription.should.equal('dev@example.com');
  });

  it('prompts for a Platform.sh API token when none are cached', () => {
    const options = getAuthOptions({}, []);
    options['api-token'].interactive.message.should.equal('Enter a Platform.sh API token');
  });
});
