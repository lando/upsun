'use strict';

const http = require('http');
const chai = require('chai');
chai.should();
const {getAccountInfo} = require('../lib/api');

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
