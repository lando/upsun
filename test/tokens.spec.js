'use strict';

const chai = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');
chai.should();
const tokens = require('../lib/tokens');

const makeCache = store => ({
  get: key => store[key],
  set: (key, value) => {
    store[key] = value;
  },
});

describe('CLI token files', () => {
  it('does not re-import a rejected CLI token until it is successfully saved', () => {
    save('upsun', 'cli-token');
    const store = {};
    const lando = {cache: makeCache(store), config: {home}};
    tokens.removeToken(lando, 'cli-token');
    tokens.readTokens(lando).should.eql([]);
    store['upsun.rejected-tokens'].should.eql(['cli-token']);
    const entry = {token: 'cli-token', email: 'me@example.com', date: 1};
    tokens.writeTokens(lando, [entry]);
    tokens.readTokens(lando).should.eql([entry]);
    store['upsun.rejected-tokens'].should.eql([]);
  });

  let home;
  const filename = vendor => path.join(home, vendor === 'upsun' ? '.upsun-cli' : '.platformsh',
    '.session', 'sess-cli-default', 'api-token');
  const save = (vendor, content) => {
    const file = filename(vendor);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, content);
    fs.utimesSync(file, 1700000000, 1700000000);
  };

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-tokens-'));
  });

  afterEach(() => fs.rmSync(home, {recursive: true, force: true}));

  for (const [vendor, binary] of [['upsun', 'upsun'], ['platformsh', 'platform']]) {
    it(`reads the ${binary} CLI plain-text token with its label and mtime`, () => {
      save(vendor, '  cli-token\n');
      tokens.readCliTokens(home, vendor).should.eql([
        {token: 'cli-token', email: `${binary} CLI token`, date: 1700000000},
      ]);
    });
  }

  it('returns no entries for missing HOME, missing files or empty files', () => {
    tokens.readCliTokens(undefined).should.eql([]);
    tokens.readCliTokens(home).should.eql([]);
    save('upsun', ' \n');
    tokens.readCliTokens(home).should.eql([]);
  });

  for (const vendor of ['upsun', 'platformsh']) {
    it(`reads the active ${vendor} session and applies the CLI slug rules`, () => {
      save(vendor, 'default-token');
      const cliHome = path.join(home, vendor === 'upsun' ? '.upsun-cli' : '.platformsh');
      fs.writeFileSync(path.join(cliHome, 'session-id'), ' Team / Work_1 \n');
      const session = path.join(cliHome, '.session', 'sess-cli-Team-Work_1');
      fs.mkdirSync(session, {recursive: true});
      fs.writeFileSync(path.join(session, 'api-token'), 'active-token');
      tokens.readCliTokens(home, vendor).map(entry => entry.token).should.eql(['active-token']);
    });
  }

  it('ignores files that cannot be read as a token', () => {
    fs.mkdirSync(filename('upsun'), {recursive: true});
    tokens.readCliTokens(home).should.eql([]);
  });

  it('merges a distinct CLI token without writing it back to the cache', () => {
    save('upsun', 'cli-token');
    const entry = {email: 'me@example.com', token: 'cached', date: 1};
    const store = {'upsun.tokens': [entry]};
    tokens.readTokens({cache: makeCache(store), config: {home}}).should.eql([
      entry, {token: 'cli-token', email: 'upsun CLI token', date: 1700000000},
    ]);
    store.should.eql({'upsun.tokens': [entry]});
  });

  it('deduplicates CLI tokens by value against either merged cache', () => {
    save('upsun', 'cli-token');
    for (const key of ['upsun.tokens', 'platformsh.tokens']) {
      const entry = {email: 'me@example.com', token: 'cli-token', date: 1};
      const store = {[key]: [entry]};
      tokens.readTokens({cache: makeCache(store), config: {home}}).should.eql([entry]);
    }
  });

  it('reads only the selected vendor CLI token and deduplicates Fixed tokens', () => {
    save('upsun', 'flex');
    save('platformsh', 'fixed');
    const store = {};
    const lando = {cache: makeCache(store), config: {home}};
    tokens.readTokens(lando, 'platformsh').should.eql([
      {email: 'platform CLI token', token: 'fixed', date: 1700000000},
    ]);
    const entry = {email: 'me@example.com', token: 'fixed', date: 1};
    store['platformsh.tokens'] = [entry];
    tokens.readTokens(lando, 'platformsh').should.eql([entry]);
  });
});

describe('token cache read-old-write-new', () => {
  it('removes every matching token from both Upsun caches without losing other entries', () => {
    const keep = {email: 'keep@example.com', token: 'keep', date: 3};
    const store = {
      'upsun.tokens': [{email: 'one@example.com', token: 'bad', date: 1}, keep],
      'platformsh.tokens': [{email: 'two@example.com', token: 'bad', date: 2}, keep],
    };
    tokens.removeToken({cache: makeCache(store)}, 'bad');
    store['upsun.tokens'].should.eql([keep]);
    store['platformsh.tokens'].should.eql([keep]);
  });

  it('only removes Fixed tokens from the Platform.sh cache', () => {
    const entry = {email: 'me@example.com', token: 'bad', date: 1};
    const store = {'upsun.tokens': [entry], 'platformsh.tokens': [entry]};
    tokens.removeToken({cache: makeCache(store)}, 'bad', 'platformsh');
    store['upsun.tokens'].should.eql([entry]);
    store['platformsh.tokens'].should.eql([]);
  });

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
