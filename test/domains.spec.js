'use strict';

const {expect} = require('chai');

describe('lib/domains', () => {
  let domainLabel;
  let getLocalHosts;
  let expandRouteUrls;
  before(() => ({domainLabel, getLocalHosts, expandRouteUrls} = require('../lib/domains')));

  it('normalizes labels without decoding punycode', () => {
    for (const [domain, label] of [
      ['EXAMPLE.COM', 'example-com'], ['xn--bcher-kva.com', 'xn-bcher-kva-com'],
      ['example.com:8443', 'example-com-8443'], ['example.com.', 'example-com'],
      ['..example___com--', 'example-com'], ['', ''], ['...', ''],
    ]) expect(domainLabel(domain)).to.equal(label);
  });

  it('returns the default host followed by unique nonempty domain labels', () => {
    expect(getLocalHosts({name: 'demo', domain: 'local', domains: [
      'EXAMPLE.COM', 'example.com.', 'example.net', '', '...', 'example-com',
    ]})).to.deep.equal(['demo.local', 'example-com.demo.local', 'example-net.demo.local']);
    expect(getLocalHosts({domains: []})).to.deep.equal(['lando.lndo.site']);
    expect(getLocalHosts()).to.deep.equal(['lando.lndo.site']);
    expect(getLocalHosts({domains: ['example.com']})).to.deep.equal([
      'lando.lndo.site', 'example-com.lando.lndo.site',
    ]);
  });

  it('pairs all placeholders while keeping default placeholders on the default host', () => {
    const hosts = ['demo.local', 'example-com.demo.local'];
    expect(expandRouteUrls('https://www.{all}/', 'https://{all}/', hosts)).to.deep.equal(hosts.map(host => ({
      url: `https://www.${host}/`, to: `https://${host}/`,
    })));
    expect(expandRouteUrls('https://{all}/', 'https://{default}/', hosts)).to.deep.equal(hosts.map(host => ({
      url: `https://${host}/`, to: 'https://demo.local/',
    })));
    expect(expandRouteUrls('https://{default}/', null, hosts)).to.deep.equal([
      {url: 'https://demo.local/', to: null},
    ]);
    expect(expandRouteUrls('https://external/', undefined, hosts)).to.deep.equal([
      {url: 'https://external/', to: undefined},
    ]);
    expect(expandRouteUrls('http://{all}/{all}', '/fixed', hosts)).to.deep.equal(hosts.map(host => ({
      url: `http://${host}/${host}`, to: '/fixed',
    })));
  });
});
