'use strict';

const http = require('http');
const chai = require('chai');
chai.should();
const {getAccountInfo} = require('../lib/api');
const api = require('../lib/api');

const me = {mail: 'dev@example.com', projects: [{id: 'abc123', name: 'my-site', title: 'My Site'}]};

// Stand-in for auth.upsun.com (token exchange) and api.upsun.com (/me)
const startServer = handler => new Promise(resolve => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      requests.push({method: req.method, url: req.url, headers: req.headers, body});
      handler(req, res, body);
    });
  });
  server.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    resolve({server, requests, config: {api_url: `${base}/api`, authentication_url: `${base}/auth`}});
  });
});

const json = (res, status, body) => {
  res.writeHead(status, {'Content-Type': 'application/json'});
  res.end(JSON.stringify(body));
};

describe('api', () => {
  let ctx;
  const fetch = global.fetch;
  const retryDelay = api.RETRY_DELAY_MS;
  const originalTimeout = process.env.UPSUN_API_TIMEOUT_MS;
  beforeEach(() => api.RETRY_DELAY_MS = 0);
  afterEach(() => {
    if (ctx) ctx.server.close();
    ctx = undefined;
    global.fetch = fetch;
    api.RETRY_DELAY_MS = retryDelay;
    if (originalTimeout === undefined) delete process.env.UPSUN_API_TIMEOUT_MS;
    else process.env.UPSUN_API_TIMEOUT_MS = originalTimeout;
  });

  it('exchanges the API token and lists environments through the global gateway', async () => {
    const environments = [{id: 'main', title: 'Main', status: 'active', type: 'production'}];
    ctx = await startServer((req, res) => req.url === '/auth/oauth2/token' ?
      json(res, 200, {access_token: 'access-1'}) : json(res, 200, environments));
    (await api.getEnvironments('selected-token', 'project/id', ctx.config)).should.eql(environments);
    const [token, listing] = ctx.requests;
    token.headers.authorization.should.equal(`Basic ${Buffer.from('platform-cli:').toString('base64')}`);
    JSON.parse(token.body).should.eql({grant_type: 'api_token', api_token: 'selected-token'});
    listing.method.should.equal('GET');
    listing.url.should.equal('/api/projects/project%2Fid/environments');
    listing.headers.authorization.should.equal('Bearer access-1');
    ctx.requests.should.have.length(2);
  });

  it('retries transient exchange and environment listing failures', async () => {
    ctx = await startServer((req, res) => {
      const attempt = ctx.requests.length;
      if (attempt === 1 || attempt === 3) return json(res, 503, {message: 'Unavailable'});
      json(res, 200, req.url === '/auth/oauth2/token' ? {access_token: 'access'} : []);
    });
    (await api.getEnvironments('token', 'project', ctx.config)).should.eql([]);
    ctx.requests.should.have.length(4);
  });

  for (const status of [503, 429]) {
    it(`returns the account when a transient HTTP ${status} recovers`, async () => {
      ctx = await startServer((req, res) => json(res, ctx.requests.length === 1 ? status : 200, me));

      const account = await api.getMe('access', ctx.config);

      account.should.eql(me);
      ctx.requests.should.have.length(2);
    });
  }

  for (const status of [400, 401, 403]) {
    it(`does not retry when the API rejects a request with HTTP ${status}`, async () => {
      const body = {error: 'insufficient_user_authentication', error_description: 'Authentication required'};
      ctx = await startServer((req, res) => json(res, status, body));

      const error = await api.getMe('access', ctx.config).then(() => null, error => error);

      error.status.should.equal(status);
      error.body.should.eql(body);
      error.message.should.equal(body.error_description);
      ctx.requests.should.have.length(1);
    });
  }

  it('does not retry API token creation when the server fails', async () => {
    ctx = await startServer((req, res) => json(res, 503, {message: 'Unavailable'}));

    const error = await api.createApiToken('access', 'user', 'Lando', ctx.config).then(() => null, error => error);

    error.status.should.equal(503);
    error.message.should.equal('Unavailable');
    ctx.requests.should.have.length(1);
  });

  for (const stage of ['request', 'body']) {
    it(`times out the ${stage} without retrying API token creation`, async () => {
      process.env.UPSUN_API_TIMEOUT_MS = '20';
      let calls = 0;
      global.fetch = (_url, {signal}) => {
        calls++;
        const pending = () => new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), {once: true}));
        return stage === 'request' ? pending() : Promise.resolve({ok: true, json: pending});
      };
      const started = Date.now();
      const error = await api.createApiToken('access', 'user', 'Lando').then(() => null, error => error);
      error.message.should.equal('Upsun API request timed out after 20 ms');
      (Date.now() - started).should.be.lessThan(1000);
      calls.should.equal(1);
    });
  }

  it('does not retry a timed-out authorization code exchange', async () => {
    process.env.UPSUN_API_TIMEOUT_MS = '20';
    let calls = 0;
    global.fetch = (_url, {signal}) => {
      calls++;
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), {once: true}));
    };
    const error = await api.exchangeAuthorizationCode({code: 'code', redirectUri: 'http://127.0.0.1:1234',
      verifier: 'proof', clientId: 'dyn-test'}).then(() => null, error => error);
    error.message.should.equal('Upsun API request timed out after 20 ms');
    calls.should.equal(1);
  });

  it('rejects after three attempts when HTTP 500 persists', async () => {
    const body = {message: 'Server failure'};
    ctx = await startServer((req, res) => json(res, 500, body));

    const error = await api.getMe('access', ctx.config).then(() => null, error => error);

    error.status.should.equal(500);
    error.body.should.eql(body);
    error.message.should.equal(body.message);
    ctx.requests.should.have.length(3);
  });

  it('rethrows the original network error when three attempts fail', async () => {
    const failure = new TypeError('Network unavailable');
    let attempts = 0;
    global.fetch = async () => {
      attempts++;
      throw failure;
    };

    const error = await api.getMe('access').then(() => null, error => error);

    error.should.equal(failure);
    attempts.should.equal(3);
  });

  it('returns the account when a network failure recovers', async () => {
    let attempts = 0;
    global.fetch = async () => {
      if (++attempts === 1) throw new TypeError('Connection lost');
      return new Response(JSON.stringify(me));
    };

    const account = await api.getMe('access');

    account.should.eql(me);
    attempts.should.equal(2);
  });

  it('does not retry API token creation when the response is lost', async () => {
    const failure = new TypeError('Connection lost');
    let attempts = 0;
    global.fetch = async () => {
      attempts++;
      throw failure;
    };

    const error = await api.createApiToken('access', 'user', 'Lando').then(() => null, error => error);

    error.should.equal(failure);
    attempts.should.equal(1);
  });

  it('does not retry authorization code exchange when the response is lost', async () => {
    const failure = new TypeError('Connection lost');
    let attempts = 0;
    global.fetch = async () => {
      attempts++;
      throw failure;
    };

    const error = await api.exchangeAuthorizationCode({code: 'code', redirectUri: 'http://127.0.0.1:1234',
      verifier: 'proof', clientId: 'dyn-test'}).then(() => null, error => error);

    error.should.equal(failure);
    attempts.should.equal(1);
  });

  it('does not retry authorization code exchange when HTTP 500 is returned', async () => {
    let attempts = 0;
    global.fetch = async () => {
      attempts++;
      return new Response(JSON.stringify({message: 'Unavailable'}), {status: 500});
    };

    const error = await api.exchangeAuthorizationCode({code: 'code', redirectUri: 'http://127.0.0.1:1234',
      verifier: 'proof', clientId: 'dyn-test'}).then(() => null, error => error);

    error.status.should.equal(500);
    attempts.should.equal(1);
  });

  it('registers a public OAuth client when browser login starts', async () => {
    ctx = await startServer((req, res) => json(res, 201, {client_id: 'dyn-test'}));
    (await api.registerOAuthClient(ctx.config)).should.equal('dyn-test');
    const request = ctx.requests[0];
    request.method.should.equal('POST');
    request.url.should.equal('/auth/oauth2/register');
    request.headers['content-type'].should.equal('application/json');
    chai.expect(request.headers.authorization).to.equal(undefined);
    JSON.parse(request.body).should.eql({client_name: 'Lando', redirect_uris: ['http://127.0.0.1'],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      token_endpoint_auth_method: 'none'});
  });

  it('exchanges a PKCE authorization code using a form body', async () => {
    ctx = await startServer((req, res) => json(res, 200, {access_token: 'access'}));
    await api.exchangeAuthorizationCode({code: 'code', redirectUri: 'http://127.0.0.1:1234',
      verifier: 'proof', clientId: 'dyn-test'}, ctx.config);
    const request = ctx.requests[0];
    request.method.should.equal('POST');
    request.url.should.equal('/auth/oauth2/token');
    request.headers['content-type'].should.equal('application/x-www-form-urlencoded');
    Object.fromEntries(new URLSearchParams(request.body)).should.eql({grant_type: 'authorization_code',
      code: 'code', redirect_uri: 'http://127.0.0.1:1234', code_verifier: 'proof', client_id: 'dyn-test'});
  });

  it('revokes a refresh token when the server returns no content', async () => {
    ctx = await startServer((req, res) => res.writeHead(204).end());
    await api.revokeOAuthToken('refresh', 'dyn-test', ctx.config);
    const request = ctx.requests[0];
    request.method.should.equal('POST');
    request.url.should.equal('/auth/oauth2/revoke');
    request.headers['content-type'].should.equal('application/x-www-form-urlencoded');
    Object.fromEntries(new URLSearchParams(request.body)).should.eql({token: 'refresh',
      token_type_hint: 'refresh_token', client_id: 'dyn-test'});
  });

  it('creates a named API token for the encoded account ID', async () => {
    ctx = await startServer((req, res) => json(res, 201, {id: 'token-id', token: 'secret', name: 'Lando'}));
    const result = await api.createApiToken('access', 'user/id', 'Lando', ctx.config);
    result.token.should.equal('secret');
    const request = ctx.requests[0];
    request.method.should.equal('POST');
    request.url.should.equal('/api/users/user%2Fid/api-tokens');
    request.headers.authorization.should.equal('Bearer access');
    request.headers['content-type'].should.equal('application/json');
    JSON.parse(request.body).should.eql({name: 'Lando'});
  });

  it('exchanges the API token and returns the account with its projects', async () => {
    ctx = await startServer((req, res) => req.url === '/auth/oauth2/token' ?
      json(res, 200, {access_token: 'access-1', token_type: 'bearer'}) :
      json(res, 200, me));

    const account = await getAccountInfo('my-api-token', ctx.config);

    account.should.eql(me);
    const [token, profile] = ctx.requests;
    token.method.should.equal('POST');
    token.url.should.equal('/auth/oauth2/token');
    token.headers.authorization.should.equal(`Basic ${Buffer.from('platform-cli:').toString('base64')}`);
    JSON.parse(token.body).should.eql({grant_type: 'api_token', api_token: 'my-api-token'});
    profile.method.should.equal('GET');
    profile.url.should.equal('/api/me');
    profile.headers.authorization.should.equal('Bearer access-1');
  });

  it('rejects with the API error description for a bad token', async () => {
    ctx = await startServer((req, res) => json(res, 401, {
      error: 'request_unauthorized',
      error_description: 'Unable to authenticate the provided API token.',
    }));

    const error = await getAccountInfo('bogus', ctx.config).then(() => null, error => error);

    error.should.be.an('error');
    error.message.should.equal('Unable to authenticate the provided API token.');
    ctx.requests.should.have.length(1);
  });

  it('rejects with the HTTP status when the error body is not JSON', async () => {
    ctx = await startServer((req, res) => req.url === '/auth/oauth2/token' ?
      json(res, 200, {access_token: 'access-1'}) :
      (res.writeHead(502), res.end('Bad Gateway')));

    const error = await getAccountInfo('my-api-token', ctx.config).then(() => null, error => error);

    error.message.should.match(/GET .*\/api\/me failed with HTTP 502/);
  });
});
