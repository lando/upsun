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
  const domains = ['example.com', 'example.net'];
  const opts = {name: 'demo', domains};
  const hosts = ['demo.lndo.site', 'example-com.demo.lndo.site', 'example-net.demo.lndo.site'];
  const allRoutes = {routes: {
    'https://{all}/': {type: 'upstream', upstream: 'app:http', primary: true},
    'https://www.{all}/': {type: 'redirect', to: 'https://{all}/'},
    'http://{all}/': {type: 'redirect', to: 'https://{all}/'},
  }};

  it('expands {all} routes once per configured domain and pairs redirects', () => {
    const {proxy} = getProxyConfig(allRoutes, opts, targets);
    expect(proxy.app_nginx.map(entry => entry.hostname)).to.deep.equal([
      ...hosts, ...hosts.map(host => `www.${host}`),
    ]);
    const names = [];
    for (const entry of proxy.app_nginx) {
      const replacement = entry.middlewares.find(m => m.key === 'redirectregex.replacement');
      expect(replacement.value).to.equal(`https://${entry.hostname.replace(/^www\./, '')}` + '$${1}');
      names.push(replacement.name);
      const regex = entry.middlewares.find(m => m.key === 'redirectregex.regex').value.replace(/\$\$/g, '$');
      expect(new RegExp(regex).test(`http://${entry.hostname}:8080/path`)).to.equal(true);
      expect(new RegExp(regex).test(`https://${entry.hostname}/path`)).to.equal(entry.hostname.startsWith('www.'));
    }
    expect(new Set(names).size).to.equal(names.length);
  });

  it('keeps {default} routes on the default host only', () => {
    expect(getProxyConfig(model, opts, targets)).to.deep.equal(getProxyConfig(model, {name: 'demo'}, targets));
  });

  it('prefers the {default} route when an {all} route resolves to the same URL', () => {
    const entries = [
      ['https://{all}/', {type: 'redirect', to: 'https://external/'}],
      ['https://{default}/', {type: 'upstream', upstream: 'api:http', primary: true}],
    ];
    for (const ordered of [entries, [...entries].reverse()]) {
      const {proxy} = getProxyConfig({routes: Object.fromEntries(ordered)}, opts, targets);
      const defaults = proxy.api.filter(entry => entry.hostname === hosts[0]);
      expect(defaults).to.have.length(1);
      expect(defaults[0].middlewares.some(m => m.key.startsWith('redirectregex'))).to.equal(false);
      expect(proxy.api).to.have.length(3);
    }
  });

  it('treats {all} like {default} without domains', () => {
    const defaults = JSON.parse(JSON.stringify(allRoutes).replace(/\{all\}/g, '{default}'));
    expect(getProxyConfig(allRoutes, {name: 'demo'}, targets))
      .to.deep.equal(getProxyConfig(defaults, {name: 'demo'}, targets));
    expect(getProxyConfig(allRoutes, {name: 'demo', domains: []}, targets))
      .to.deep.equal(getProxyConfig(defaults, {name: 'demo'}, targets));
  });

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
      {name: 'upsun-redirect-https', key: 'redirectregex.regex',
        value: '^https?://www\\.my-app\\.lndo\\.site(?::\\d+)?(.*)$$'},
      {name: 'upsun-redirect-https', key: 'redirectregex.replacement', value: 'https://my-app.lndo.site$${1}'},
      {name: 'upsun-redirect-https', key: 'redirectregex.permanent', value: 'true'},
    ]);
    expect(warnings).to.deep.equal([]);
  });

  it('attaches external redirects to the primary target', () => {
    const {proxy} = getProxyConfig(model, {domain: 'lndo.site', name: 'my-app'}, targets);
    const redirect = proxy.app_nginx.find(entry => entry.pathname === '/dead');
    expect(redirect.middlewares).to.include.deep.members([
      {name: 'upsun-redirect-https', key: 'redirectregex.replacement', value: 'https://nowhere$${1}'},
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
  it('redirects plain http routes without catching the https upstream', () => {
    const upgrade = {...model, routes: {
      ...model.routes,
      'http://{default}/': {type: 'redirect', to: 'https://{default}/', primary: false, redirects: {}, raw: {}},
    }};
    const {proxy} = getProxyConfig(upgrade, {domain: 'lndo.site', name: 'my-app'}, targets);
    const entry = proxy.app_nginx.find(e => e.hostname === 'my-app.lndo.site' && e.pathname === '/');
    const redirect = entry.middlewares.filter(m => m.name === 'upsun-redirect-http');
    // an https? regex here would match the https router too and loop forever
    expect(redirect.map(m => m.value)).to.deep.equal([
      '^http://my-app\\.lndo\\.site(?::\\d+)?(.*)$$', 'https://my-app.lndo.site$${1}', 'true',
    ]);
  });
});
