'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {EventEmitter} = require('events');
const chai = require('chai');
chai.should();
const login = require('../lib/login');
const api = require('../lib/api');

const get = url => new Promise((resolve, reject) => {
  http.get(url, res => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => resolve({status: res.statusCode, body}));
  }).on('error', reject);
});
const callback = (url, params = {}) => {
  const authorize = new URL(url);
  const target = new URL(authorize.searchParams.get('redirect_uri'));
  target.search = new URLSearchParams({state: authorize.searchParams.get('state'), code: 'code', ...params});
  return target;
};
const input = isTTY => Object.assign(new EventEmitter(), {isTTY});
const rejected = promise => promise.then(() => {
  throw new Error('Expected rejection');
}, error => error);

describe('login', () => {
  let server;
  let config;
  let requests;
  let browserUrl;
  let browserUrls;
  let createFailure;
  let stepUps;
  let beforeStepUp;
  let revokeFailure;
  let retryDelay;
  let secondUser;
  beforeEach(async () => {
    retryDelay = api.RETRY_DELAY_MS;
    api.RETRY_DELAY_MS = 0;
    requests = [];
    browserUrl = undefined;
    browserUrls = [];
    createFailure = false;
    stepUps = 0;
    secondUser = undefined;
    beforeStepUp = () => {};
    revokeFailure = false;
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        requests.push({url: req.url, body});
        let result;
        let status = 200;
        if (req.url === '/oauth2/register') result = {client_id: 'dyn-test'};
        else if (req.url === '/oauth2/token') {
          const form = new URLSearchParams(body);
          const auth = new URL(browserUrl);
          const proof = crypto.createHash('sha256').update(form.get('code_verifier')).digest('base64url');
          proof.should.equal(auth.searchParams.get('code_challenge'));
          form.get('redirect_uri').should.equal(auth.searchParams.get('redirect_uri'));
          form.get('redirect_uri').should.match(/^http:\/\/127\.0\.0\.1:\d+$/);
          const n = browserUrls.length;
          result = {access_token: `access-secret-${n}`, refresh_token: `refresh-secret-${n}`};
        } else if (req.url === '/me') {
          result = browserUrls.length > 1 && secondUser ? secondUser :
            {id: 'user', mail: 'dev@example.com', username: 'developer'};
        } else if (req.url === '/users/user/api-tokens' && stepUps > 0) {
          stepUps -= 1;
          beforeStepUp();
          status = 401;
          result = {error: 'insufficient_user_authentication', max_age: 60, amr: ['mfa'],
            error_description: 'More recent authentication is required.'};
        } else if (req.url === '/users/user/api-tokens' || req.url === `/users/${secondUser?.id}/api-tokens`) {
          status = createFailure ? 403 : 201;
          result = createFailure ? {message: 'Creation denied'} :
            {id: 'token-id', token: 'api-secret', name: JSON.parse(body).name};
        } else if (req.url === '/oauth2/revoke') {
          status = revokeFailure ? 500 : 204;
          result = {message: 'Revocation unavailable'};
        } else status = 404;
        res.writeHead(status, {'Content-Type': 'application/json'});
        res.end(JSON.stringify(result));
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    config = {api_url: base, authentication_url: base, console_url: base};
  });
  afterEach(async () => {
    api.RETRY_DELAY_MS = retryDelay;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const open = url => {
    browserUrl = url;
    browserUrls.push(url);
    get(callback(url)).catch(error => {
      throw error;
    });
  };

  it('accepts a valid callback when using a loopback PKCE redirect', async () => {
    const result = await login.authorize({clientId: 'dyn-test', config, open});
    result.code.should.equal('code');
    result.redirectUri.should.match(/^http:\/\/127\.0\.0\.1:\d+$/);
    result.verifier.should.match(/^[\w-]{43}$/);
    new URL(browserUrl).searchParams.get('state').should.match(/^[\w-]{22}$/);
    const error = await rejected(get(result.redirectUri));
    error.code.should.equal('ECONNREFUSED');
  });

  it('keeps waiting when favicon and incorrect state requests arrive', async () => {
    let responses;
    const result = await login.authorize({clientId: 'dyn-test', config, open: url => {
      browserUrl = url;
      responses = (async () => {
        const uri = new URL(url).searchParams.get('redirect_uri');
        (await get(`${uri}/favicon.ico`)).status.should.equal(404);
        (await get(callback(url, {state: 'wrong'}))).status.should.equal(400);
        (await get(`${uri}/?code=code`)).status.should.equal(400);
        return get(callback(url));
      })();
    }});
    result.code.should.equal('code');
    (await responses).status.should.equal(200);
  });

  for (const event of ['finish', 'close', 'error', 'timeout']) {
    it(`settles an accepted callback even when its response ends with ${event}`, async () => {
      const createServer = http.createServer;
      let responseStarted = false;
      let requestHandler;
      let closed = false;
      let connectionsClosed = false;
      http.createServer = handler => {
        requestHandler = handler;
        const callbackServer = new EventEmitter();
        callbackServer.listen = (_port, _host, ready) => ready();
        callbackServer.address = () => ({port: 12345});
        callbackServer.close = () => closed = true;
        callbackServer.closeAllConnections = () => connectionsClosed = true;
        return callbackServer;
      };
      try {
        const promise = login.authorize({clientId: 'test', config, timeout: 0, open: url => {
          const response = new EventEmitter();
          response.writeHead = () => response;
          response.end = () => {
            responseStarted = true;
            if (event !== 'timeout') response.emit(event, new Error('Dropped connection'));
            return response;
          };
          requestHandler({url: `/${callback(url).search}`}, response);
        }});
        if (event === 'timeout') {
          (await rejected(promise)).message.should.equal('Timed out waiting for the browser login');
        } else (await promise).code.should.equal('code');
        responseStarted.should.equal(true);
        closed.should.equal(true);
        connectionsClosed.should.equal(true);
      } finally {
        http.createServer = createServer;
      }
    });
  }

  it('rejects with an escaped description when authorization fails', async () => {
    let response;
    const error = await rejected(login.authorize({clientId: 'dyn-test', config, open: url => {
      response = get(callback(url, {error: 'server_error', error_description: '<script>failed</script>.'}));
    }}));
    error.message.should.equal('<script>failed</script>.');
    error.code.should.equal('server_error');
    const html = (await response).body;
    html.should.include('&lt;script&gt;failed&lt;/script&gt;. Return');
    html.should.not.include('<script>');
  });

  for (const code of ['access_denied', 'consent_required']) {
    it(`reports ${code} as a declined login`, async () => {
      let response;
      const error = await rejected(login.authorize({clientId: 'dyn-test', config, open: url => {
        response = get(callback(url, {error: code,
          error_description: 'The Authorization Server requires End-User consent.'}));
      }}));
      error.message.should.equal('You declined access in the browser');
      error.code.should.equal(code);
      (await response).body.should.include('Upsun: You declined access in the browser. Return');
    });
  }

  it('closes the callback server when authorization is aborted', async () => {
    const controller = new AbortController();
    let uri;
    const error = await rejected(login.authorize({clientId: 'dyn-test', config, signal: controller.signal,
      open: url => {
        uri = new URL(url).searchParams.get('redirect_uri');
        controller.abort();
      }}));
    error.name.should.equal('AbortError');
    (await rejected(get(uri))).code.should.equal('ECONNREFUSED');
  });

  it('times out when no browser callback arrives', async () => {
    const error = await rejected(login.authorize({clientId: 'dyn-test', config, open: () => {}, timeout: 10}));
    error.message.should.equal('Timed out waiting for the browser login');
  });

  it('does not open a browser when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let opened = false;
    const error = await rejected(login.authorize({clientId: 'dyn-test', signal: controller.signal,
      open: () => opened = true}));
    error.name.should.equal('AbortError');
    opened.should.equal(false);
  });

  it('creates the named credential and revokes OAuth credentials when login succeeds', async () => {
    const result = await login.browserLogin({config, open, name: 'Lando (workstation)'});
    result.should.eql({token: 'api-secret', tokenId: 'token-id', name: 'Lando (workstation)',
      email: 'dev@example.com', username: 'developer'});
    requests.map(request => request.url).should.eql([
      '/oauth2/register', '/oauth2/token', '/me', '/users/user/api-tokens', '/oauth2/revoke']);
  });

  it('revokes OAuth credentials and preserves the username when token creation fails', async () => {
    createFailure = true;
    const error = await rejected(login.browserLogin({config, open, name: 'Lando'}));
    error.username.should.equal('developer');
    error.status.should.equal(403);
    requests[requests.length - 1].url.should.equal('/oauth2/revoke');
  });

  it('asks for a login session fresh enough to create API tokens', async () => {
    await login.browserLogin({config, open, name: 'Lando'});
    const params = new URL(browserUrls[0]).searchParams;
    params.get('max_age').should.equal('300');
    chai.expect(params.get('amr')).to.equal(null);
  });

  it('logs in again with the server requirements when token creation needs step-up', async () => {
    stepUps = 1;
    const urls = [];
    const result = await login.browserLogin({config, open, name: 'Lando',
      onUrl: (url, context) => urls.push(context)});
    result.token.should.equal('api-secret');
    urls.should.eql([{stepUp: false}, {stepUp: true}]);
    const params = new URL(browserUrls[1]).searchParams;
    params.get('max_age').should.equal('60');
    params.get('amr').should.equal('mfa');
    requests.map(request => request.url).should.eql(['/oauth2/register', '/oauth2/token', '/me',
      '/users/user/api-tokens', '/oauth2/token', '/me', '/users/user/api-tokens', '/oauth2/revoke', '/oauth2/revoke']);
    requests.filter(request => request.url === '/oauth2/revoke')
        .map(request => new URLSearchParams(request.body).get('token'))
        .should.eql(['refresh-secret-1', 'refresh-secret-2']);
  });

  it('only retries step-up once and keeps the username for the fallback URL', async () => {
    stepUps = 2;
    const error = await rejected(login.browserLogin({config, open, name: 'Lando'}));
    error.status.should.equal(401);
    error.username.should.equal('developer');
    browserUrls.should.have.length(2);
    requests.filter(request => request.url === '/oauth2/revoke').should.have.length(2);
  });

  it('creates and returns the second account credential after step-up changes users', async () => {
    stepUps = 1;
    secondUser = {id: 'second', mail: 'second@example.com', username: 'second-user'};
    const result = await login.browserLogin({config, open, name: 'Lando'});
    result.should.include({email: secondUser.mail, username: secondUser.username});
    requests.filter(request => request.url === '/me').should.have.length(2);
    requests.map(request => request.url).should.include('/users/second/api-tokens');
    requests.filter(request => request.url === '/users/user/api-tokens').should.have.length(1);
  });

  it('returns the API token when best-effort revocation fails', async () => {
    revokeFailure = true;
    (await login.browserLogin({config, open, name: 'Lando'})).token.should.equal('api-secret');
  });

  for (const [platform, env, command] of [
    ['darwin', {}, 'open'], ['win32', {}, 'rundll32'],
    ['linux', {WSL_DISTRO_NAME: 'Ubuntu'}, 'rundll32.exe'],
    ['linux', {WSL_INTEROP: '/run/WSL'}, 'rundll32.exe'],
    ['linux', {DISPLAY: ':0'}, 'xdg-open'], ['linux', {WAYLAND_DISPLAY: 'wayland-0'}, 'xdg-open'],
  ]) {
    it(`attempts a detached browser launch on ${platform} with ${JSON.stringify(env)}`, () => {
      let invocation;
      const child = new EventEmitter();
      let unreferenced = false;
      child.unref = () => unreferenced = true;
      login.openBrowser('https://example.test/?a=1&b=2', {platform, env, spawn: (...args) => {
        invocation = args;
        return child;
      }}).should.equal(true);
      invocation.should.eql([command, command.startsWith('rundll32') ?
        ['url.dll,FileProtocolHandler', 'https://example.test/?a=1&b=2'] : ['https://example.test/?a=1&b=2'],
      {detached: true, stdio: 'ignore'}]);
      unreferenced.should.equal(true);
      (() => child.emit('error', new Error('Missing opener'))).should.not.throw();
    });
  }

  it('does not spawn a text browser when Linux has no graphical session', () => {
    login.openBrowser('https://example.test', {platform: 'linux', env: {},
      spawn: () => {
        throw new Error('Must not spawn');
      }}).should.equal(false);
  });

  it('waits for Enter and ignores Escape and letters when input is a terminal', async () => {
    const stream = input(true);
    const enter = login.waitForEnter(stream);
    let resolved = false;
    enter.promise.then(() => resolved = true);
    stream.emit('keypress', '', {name: 'escape'});
    stream.emit('keypress', 'x', {name: 'x'});
    await Promise.resolve();
    resolved.should.equal(false);
    stream.emit('keypress', '\r', {name: 'return'});
    await enter.promise;
    resolved.should.equal(true);
    enter.cancel();
    stream.listenerCount('keypress').should.equal(0);
  });

  it('never resolves the skip promise when input is not a terminal', async () => {
    const stream = input(false);
    const enter = login.waitForEnter(stream);
    let resolved = false;
    enter.promise.then(() => resolved = true);
    stream.emit('keypress', '\r', {name: 'enter'});
    await Promise.resolve();
    resolved.should.equal(false);
    enter.cancel();
  });

  it('caches the new credential without printing secrets when the prompt succeeds', async () => {
    const cache = new Map();
    const lando = {cache: {get: key => cache.get(key), set: (key, value) => cache.set(key, value)}};
    let output = '';
    const result = await login.promptBrowserLogin({lando, vendor: 'platformsh', config, open,
      input: input(false), output: {write: text => output += text}, hostname: 'workstation'});
    result.should.equal('api-secret');
    cache.get('platformsh.tokens')[0].should.include({token: 'api-secret', email: 'dev@example.com'});
    output.should.include('Created the API token "Lando (workstation)" for dev@example.com.');
    for (const secret of ['api-secret', 'access-secret', 'refresh-secret']) output.should.not.include(secret);
  });

  it('ignores an Enter pressed between the login and a step-up login', async () => {
    stepUps = 1;
    const stream = input(true);
    beforeStepUp = () => stream.emit('keypress', '\r', {name: 'return'});
    let output = '';
    const result = await login.promptBrowserLogin({lando: {cache: {get: () => undefined, set: () => {}}},
      vendor: 'upsun', config, open, input: stream, output: {write: text => output += text}});
    result.should.equal('api-secret');
    browserUrls.should.have.length(2);
    output.should.not.include('Skipped');
    stream.listenerCount('keypress').should.equal(0);
  });

  it('persists the new token with only its vendor cache, not CLI-file or legacy tokens', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-login-'));
    try {
      const session = path.join(home, '.upsun-cli', '.session', 'sess-cli-default');
      fs.mkdirSync(session, {recursive: true});
      fs.writeFileSync(path.join(session, 'api-token'), 'cli-file-token');
      const saved = {token: 'saved', email: 'saved@example.com', date: 1};
      const legacy = {token: 'legacy', email: 'legacy@example.com', date: 1};
      const cache = new Map([['upsun.tokens', [saved]], ['platformsh.tokens', [legacy]]]);
      const lando = {config: {home}, cache: {get: key => cache.get(key), set: (key, value) => cache.set(key, value)}};
      await login.promptBrowserLogin({lando, vendor: 'upsun', config, open,
        input: input(false), output: {write: () => {}}});
      cache.get('upsun.tokens').map(entry => entry.token).should.eql(['saved', 'api-secret']);
      cache.get('platformsh.tokens').should.eql([legacy]);
    } finally {
      fs.rmSync(home, {recursive: true, force: true});
    }
  });

  it('skips when Enter is pressed during the step-up login', async () => {
    stepUps = 1;
    const stream = input(true);
    let output = '';
    const result = await login.promptBrowserLogin({lando: {}, vendor: 'upsun', config, input: stream,
      output: {write: text => output += text}, open: url => {
        if (browserUrls.length === 0) open(url);
        else stream.emit('keypress', '\r', {name: 'return'});
      }});
    chai.expect(result).to.equal(undefined);
    output.should.include('Skipped the browser login.');
    output.should.include(`${config.console_url}/-/users/developer/settings/tokens`);
    stream.listenerCount('keypress').should.equal(0);
  });

  it('still returns a created token when Lando cannot cache it', async () => {
    let output = '';
    const lando = {cache: {get: () => undefined, set: () => {
      throw new Error('disk full');
    }}};
    const result = await login.promptBrowserLogin({lando, vendor: 'upsun', config, open, input: input(false),
      output: {write: text => output += text}, hostname: 'workstation'});
    result.should.equal('api-secret');
    output.should.include('Created the API token "Lando (workstation)" for dev@example.com.');
    output.should.include('Lando couldn\'t save the token for next time: disk full');
    output.should.not.include('Browser login failed');
  });

  it('explains a repeat browser login when Upsun asks for step-up', async () => {
    stepUps = 1;
    let output = '';
    const result = await login.promptBrowserLogin({lando: {cache: {get: () => undefined, set: () => {}}},
      vendor: 'upsun', config, open, input: input(false), output: {write: text => output += text}});
    result.should.equal('api-secret');
    output.should.include('Upsun needs you to log in again before it creates an API token.');
  });

  it('falls back to the profile URL when Enter skips browser login', async () => {
    const stream = input(true);
    let output = '';
    const result = await login.promptBrowserLogin({lando: {}, vendor: 'upsun', config, input: stream,
      open: () => stream.emit('keypress', '\r', {name: 'return'}), output: {write: text => output += text}});
    chai.expect(result).to.equal(undefined);
    output.should.include('Skipped the browser login.');
    output.should.include(`${config.console_url}/-/users/me/settings (API Tokens tab)`);
    stream.listenerCount('keypress').should.equal(0);
  });

  it('prints the exact tokens URL when a known account cannot create a token', async () => {
    createFailure = true;
    let output = '';
    const result = await login.promptBrowserLogin({lando: {}, vendor: 'upsun', config, open,
      input: input(false), output: {write: text => output += text}});
    chai.expect(result).to.equal(undefined);
    output.should.include('Browser login failed: Creation denied');
    output.should.include(`${config.console_url}/-/users/developer/settings/tokens`);
  });
});
