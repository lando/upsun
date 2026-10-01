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
  afterEach(() => ctx && ctx.server.close());

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
