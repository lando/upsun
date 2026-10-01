'use strict';

const {expect} = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');
const indexHook = require('../index');

describe('CLI cached token validation', () => {
  let home;
  let originalFetch;
  let store;
  let handlers;
  let warnings;
  let writes;
  let removed;
  let data;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-index-'));
    originalFetch = global.fetch;
    const entry = {token: 'cached', email: 'me@example.com', date: 1};
    store = {
      'upsun.tokens': [entry],
      'platformsh.tokens': [entry],
      'demo.meta.cache': {...entry, project: 'project-id'},
      'demo.tooling.cache': {pull: {}},
    };
    handlers = {};
    warnings = [];
    writes = [];
    removed = [];
    indexHook({
      config: {home},
      cache: {
        get: key => store[key],
        set: (key, value, options) => {
          store[key] = value;
          writes.push({key, options});
        },
        remove: key => {
          delete store[key];
          removed.push(key);
        },
      },
      log: {alsoSanitize: () => {}, warn: (...args) => warnings.push(args)},
      events: {on: (name, fn) => {
        handlers[name] = fn;
      }},
    });
    data = {options: {_app: {name: 'demo', recipe: 'upsun', root: home}, auth: 'cached'}};
    global.fetch = async () => ({ok: false, status: 401, json: async () => ({error: 'invalid'})});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    fs.rmSync(home, {recursive: true, force: true});
  });

  for (const command of ['pull', 'push', 'switch']) {
    it(`scrubs a rejected cached token before ${command}`, async () => {
      await handlers[`cli-${command}-answers`](data);
      expect(store['upsun.tokens']).to.deep.equal([]);
      expect(store['platformsh.tokens']).to.deep.equal([]);
      expect(store['demo.meta.cache']).to.deep.equal({date: 1, project: 'project-id'});
      expect(removed).to.deep.equal(['demo.tooling.cache']);
      expect(data.options).not.to.have.property('auth');
      expect(writes.every(write => write.options.persist)).to.equal(true);
      expect(warnings).to.deep.equal([[
        'the cached Upsun API token for %s is invalid; it has been removed. ' +
          'Run the command again to enter a new token.',
        'me@example.com',
      ]]);
    });
  }

  it('leaves a valid token and all caches alone', async () => {
    const requests = [];
    global.fetch = async (url, options) => {
      requests.push({url, options});
      return {ok: true, json: async () => url.endsWith('/oauth2/token') ?
        {access_token: 'access'} : {mail: 'me@example.com'}};
    };
    await handlers['cli-pull-answers'](data);
    expect(requests).to.have.length(2);
    expect(JSON.parse(requests[0].options.body).api_token).to.equal('cached');
    expect(requests[1].url).to.match(/\/me$/);
    expect(requests[1].options.headers.Authorization).to.equal('Bearer access');
    expect(data.options.auth).to.equal('cached');
    expect(writes).to.deep.equal([]);
    expect(removed).to.deep.equal([]);
    expect(warnings).to.deep.equal([]);
  });

  it('does not validate freshly entered tokens, absent tokens, or other recipes', async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      throw new Error('unexpected fetch');
    };
    data.options.auth = 'fresh';
    await handlers['cli-pull-answers'](data);
    expect(data.options.auth).to.equal('fresh');
    delete data.options.auth;
    await handlers['cli-pull-answers'](data);
    data.options.auth = 'cached';
    data.options._app.recipe = 'lamp';
    await handlers['cli-pull-answers'](data);
    await handlers['cli-pull-answers']({});
    expect(calls).to.equal(0);
    expect(writes).to.deep.equal([]);
  });

  it('keeps the cached token when the API is unreachable or failing', async () => {
    for (const fetch of [
      async () => {
        throw new TypeError('fetch failed');
      },
      async () => ({ok: false, status: 503, json: async () => null}),
    ]) {
      global.fetch = fetch;
      data.options.auth = 'cached';
      await handlers['cli-pull-answers'](data);
      expect(data.options.auth).to.equal('cached');
      expect(store['upsun.tokens']).to.have.length(1);
      expect(store['demo.tooling.cache']).to.exist;
      expect(warnings).to.have.length(0);
    }
  });

  it('preserves metadata belonging to a different token', async () => {
    const meta = {token: 'other', email: 'other@example.com'};
    store['demo.meta.cache'] = meta;
    await handlers['cli-pull-answers'](data);
    expect(store['demo.meta.cache']).to.deep.equal(meta);
    expect(removed).to.deep.equal(['demo.tooling.cache']);
  });

  it('detects Fixed before the recipe builder runs, including the legacy recipe alias', async () => {
    fs.writeFileSync(path.join(home, '.platform.app.yaml'), 'name: app\n');
    data.options._app.recipe = 'platformsh';
    await handlers['cli-pull-answers'](data);
    expect(store['platformsh.tokens']).to.deep.equal([]);
    expect(store['upsun.tokens']).to.have.length(1);
  });

  it('prefers the vendor set by the recipe builder', async () => {
    data.options._app.upsun = {cli: {vendor: 'platformsh'}};
    await handlers['cli-pull-answers'](data);
    expect(store['platformsh.tokens']).to.deep.equal([]);
    expect(store['upsun.tokens']).to.have.length(1);
  });
});
