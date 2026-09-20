'use strict';

const {expect} = require('chai');
const {getProxyConfig} = require('../lib/routes');

const model = {
  routes: {
    'https://{default}/': {type: 'upstream', upstream: 'app:http', to: null, primary: true},
    'https://www.{default}/': {type: 'redirect', upstream: null, to: 'https://{default}/', primary: false},
    'https://api.{default}/v1': {type: 'upstream', upstream: 'api:http', to: null, primary: false},
    'https://{default}/dead': {type: 'redirect', upstream: null, to: 'https://nowhere/', primary: false},
  },
};
const targets = {app: {service: 'app_nginx', port: 80}, api: {service: 'api', port: 8888}};

describe('lib/routes', () => {
  it('maps upstream routes to the fronting lando service with upsun headers', () => {
    const {proxy} = getProxyConfig(model, 'lndo.site', targets);
    expect(proxy.app_nginx[0]).to.include({hostname: 'app.lndo.site', port: '80', pathname: '/'});
    expect(proxy.app_nginx[0].middlewares.map(m => m.value)).to.deep.equal([
      'host.docker.internal', 'https://app.lndo.site/', 'on',
    ]);
    expect(proxy.api[0]).to.include({hostname: 'api.api.lndo.site', port: '8888', pathname: '/v1'});
  });

  it('serves redirect routes from their upstream target and warns', () => {
    const {proxy, warnings} = getProxyConfig(model, 'lndo.site', targets);
    expect(proxy.app_nginx.map(r => r.hostname)).to.deep.equal(['app.lndo.site', 'www.app.lndo.site']);
    expect(warnings.map(w => w.code)).to.deep.equal(['redirect-route']);
  });

  it('ignores routes whose app has no target', () => {
    const {proxy} = getProxyConfig(model, 'lndo.site', {app: targets.app});
    expect(proxy).to.not.have.property('api');
  });
});
