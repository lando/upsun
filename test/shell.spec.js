'use strict';

const {expect} = require('chai');
const {execFileSync} = require('child_process');
const {shellQuote, shellArgument} = require('../lib/shell');

describe('shell quoting', () => {
  it('quotes empty values, metacharacters and single quotes', () => {
    expect(shellQuote('')).to.equal('\'\'');
    expect(shellQuote('it\'s ; $HOME')).to.equal('\'it\'\\\'\'s ; $HOME\'');
  });

  it('leaves safe arguments readable but always quotes leading hyphens', () => {
    expect(shellArgument('/app/site-a')).to.equal('/app/site-a');
    expect(shellArgument('-option')).to.equal('\'-option\'');
    expect(shellArgument('')).to.equal('\'\'');
    expect(shellArgument('a b;')).to.equal('\'a b;\'');
  });

  it('round-trips literal values through the same shell core uses', () => {
    const env = {...process.env};
    for (const key of ['BASH_ENV', 'ENV', 'SHELLOPTS', 'BASHOPTS']) delete env[key];
    for (const value of ['', 'it\'s ; $HOME', '-option', '/app/site-a']) {
      // Resolve sh through PATH so Git for Windows supplies the POSIX shell on Windows.
      const output = execFileSync('sh', ['-c', `printf '%s' ${shellArgument(value)}`], {
        encoding: 'utf8', env, timeout: 10000,
      });
      expect(output).to.equal(value);
    }
  });
});
