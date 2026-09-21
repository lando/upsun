'use strict';

const {expect} = require('chai');
const {getProxyConfig} = require('../lib/routes');

const model = {
  routes: {
    'https://{default}/': {type: 'upstream', upstream: 'app:http', to: null, primary: true, redirects: {paths: {
      '/old': {to: '/new'},
      '/gone': {to: 'https://example.com/', code: 302},
      '^/legacy/(.*)$': {to: '/archive/$1', regexp: true},
    }}},
    'https://www.{default}/': {type: 'redirect', upstream: null, to: 'https://{default}/', primary: false},
    'https://api.{default}/v1': {type: 'upstream', upstream: 'api:http', to: null, primary: false},
    'https://{default}/dead': {type: 'redirect', upstream: null, to: 'https://nowhere/', primary: false},
  },
};
const targets = {app: {service: 'app_nginx', port: 80}, api: {service: 'api', port: 8888}};

describe('lib/routes', () => {
  it('keys default routes on the lando app name', () => {
    const {proxy} = getProxyConfig(model, {domain: 'lndo.site', name: 'my-app'}, targets);
    expect(proxy.app_nginx[0]).to.include({hostname: 'my-app.lndo.site', port: '80', pathname: '/'});
    expect(proxy.app_nginx[0].middlewares.map(m => m.value)).to.deep.equal([
      'host.docker.internal', 'https://my-app.lndo.site/', 'on',
      '^https?://my-app\\.lndo\\.site(?::\\d+)?/legacy/(.*)$$', 'https://my-app.lndo.site/archive/$${1}', 'true',
    ]);
    expect(proxy.api[0]).to.include({hostname: 'api.my-app.lndo.site', port: '8888', pathname: '/v1'});
  });

  it('turns redirect routes into permanent redirectregex middlewares', () => {
    const {proxy, warnings} = getProxyConfig(model, {domain: 'lndo.site', name: 'my-app'}, targets);
    const redirect = proxy.app_nginx.find(entry => entry.hostname === 'www.my-app.lndo.site');
    expect(redirect.middlewares).to.include.deep.members([
      {name: 'upsun-redirect', key: 'redirectregex.regex',
        value: '^https?://www\\.my-app\\.lndo\\.site(?::\\d+)?(.*)$$'},
      {name: 'upsun-redirect', key: 'redirectregex.replacement', value: 'https://my-app.lndo.site$${1}'},
      {name: 'upsun-redirect', key: 'redirectregex.permanent', value: 'true'},
    ]);
    expect(warnings).to.deep.equal([]);
  });

  it('attaches external redirects to the primary target', () => {
    const {proxy} = getProxyConfig(model, {domain: 'lndo.site', name: 'my-app'}, targets);
    const redirect = proxy.app_nginx.find(entry => entry.pathname === '/dead');
    expect(redirect.middlewares).to.include.deep.members([
      {name: 'upsun-redirect', key: 'redirectregex.replacement', value: 'https://nowhere$${1}'},
    ]);
  });

  it('expands redirects.paths into path entries with 301 or 302', () => {
    const {proxy} = getProxyConfig(model, {domain: 'lndo.site', name: 'my-app'}, targets);
    const old = proxy.app_nginx.find(entry => entry.pathname === '/old');
    expect(old.middlewares).to.include.deep.members([
      {name: 'upsun-redirect-0', key: 'redirectregex.replacement',
        value: 'https://my-app.lndo.site/new$${1}'},
      {name: 'upsun-redirect-0', key: 'redirectregex.permanent', value: 'true'},
    ]);
    const gone = proxy.app_nginx.find(entry => entry.pathname === '/gone');
    expect(gone.middlewares).to.include.deep.members([
      {name: 'upsun-redirect-1', key: 'redirectregex.replacement', value: 'https://example.com/$${1}'},
      {name: 'upsun-redirect-1', key: 'redirectregex.permanent', value: 'false'},
    ]);
    expect(proxy.app_nginx[0].middlewares).to.include.deep.members([
      {name: 'upsun-redirect-2', key: 'redirectregex.regex',
        value: '^https?://my-app\\.lndo\\.site(?::\\d+)?/legacy/(.*)$$'},
    ]);
  });

  it('ignores routes whose app has no target', () => {
    const {proxy} = getProxyConfig(model, {domain: 'lndo.site', name: 'my-app'}, {app: targets.app});
    expect(proxy).to.not.have.property('api');
  });
});
