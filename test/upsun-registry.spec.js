'use strict';

const chai = require('chai');
chai.should();
const {normalizeUpstream, chooseTag, buildTables, render} = require('../dev/update-upsun-registry');
const {COMPOSE} = require('../lib/mapping/services');
const {getPinnedTag, getLifecycleWarning, registryType} = require('../lib/mapping/registry');
const {toLandoWarning} = require('../lib/warnings');

const images = [{os: 'linux', architecture: 'amd64'}, {os: 'linux', architecture: 'arm64'},
  {os: 'unknown', architecture: 'unknown'}];
const entry = (raw, status = 'supported') => ({upsun: {status}, upstream: {eolFrom: null},
  manifest: {package_version: {raw}}});
const registry = {
  mercure: {docs: {url: 'https://example.test/mercure'}, versions: {'0': entry('0.24.2-0psh1')}},
  influxdb: {docs: {url: 'https://example.test/influxdb'}, versions: {'3': entry('3.12.0-1')}},
  valkey: {docs: {url: 'https://example.test/valkey'}, versions: {
    '9.0': entry('9.0.6-0psh1'), '8.0': entry('8.0.1', 'retired'),
    '7.0': entry('7.0.1', 'decommissioned'), '10': {upsun: {status: 'incoming'}},
  }},
};

describe('Upsun registry generator', () => {
  it('strips epochs and distro revisions from upstream package versions', () => {
    normalizeUpstream('1:11.8.6+maria~deb13').should.equal('11.8.6');
    normalizeUpstream('26.8.15.10-0psh1').should.equal('26.8.15.10');
    chai.expect(normalizeUpstream(undefined)).to.equal(undefined);
  });

  it('skips a mismatched segment prefix without querying Docker Hub', async () => {
    const docker = {detail: () => {
      throw new Error('must not fetch');
    }};
    const result = await chooseTag({type: 'varnish', version: '9.0', raw: '9.1.0', config: {}}, docker);
    result.reason.should.include('does not match version prefix');
  });

  it('uses the mercure v prefix and omits retired pins but retains lifecycle metadata', async () => {
    const calls = [];
    const docker = {detail: async (image, tag) => {
      calls.push(tag);
      return {images};
    }};
    const reports = [];
    const tables = await buildTables(registry, docker, message => reports.push(message));
    tables.TAGS.should.eql({mercure: {'0': 'v0.24.2'}, valkey: {'9.0': '9.0.6'}});
    calls.should.eql(['v0.24.2', '9.0.6']);
    tables.IMAGES.valkey.versions['8.0'].status.should.equal('retired');
    tables.IMAGES.valkey.versions['7.0'].status.should.equal('decommissioned');
    reports.should.include('unpinned influxdb:3 (InfluxDB 3 requires a different entrypoint)');
    reports.should.include('unpinned valkey:10 (missing package version)');
  });

  it('chooses the numerically highest formatter-compatible multi-arch fallback', async () => {
    const fetched = [];
    const docker = {
      detail: async (image, tag) => {
        fetched.push(tag);
        return tag === '4.3.10-management' ? {images} : {images: [images[0]]};
      },
      list: async (image, name) => {
        name.should.equal('4.3.');
        return [
          {name: '4.3.99-management', images: [images[0]]},
          {name: '4.3.10-management'}, {name: '4.3.9-management', images},
          {name: '4.3.100-alpine', images}, {name: '14.3.999-management', images},
        ];
      },
    };
    const result = await chooseTag({type: 'rabbitmq', version: '4.3', raw: '4.3.6-1',
      config: COMPOSE.rabbitmq}, docker);
    result.tag.should.equal('4.3.10-management');
    fetched.should.eql(['4.3.6-management', '4.3.10-management']);
  });

  it('leaves amd64-only tags unpinned', async () => {
    const docker = {detail: async () => ({images: [images[0]]}),
      list: async () => [{name: '9.0.7', images: [images[0]]}]};
    const result = await chooseTag({type: 'valkey', version: '9.0', raw: '9.0.6', config: COMPOSE.valkey}, docker);
    result.reason.should.include('no matching linux/amd64 and linux/arm64');
  });

  it('renders deterministic frozen data, including EOL date parts', async () => {
    const docker = {detail: async () => ({images})};
    const input = {...registry, python: {docs: {url: 'https://example.test/python'}, versions: {
      '2.7': {...entry('2.7.18', 'retired'), upstream: {eolFrom: '2020-01-01T00:00:00Z'}},
    }}};
    const first = await buildTables(input, docker, () => {});
    const reversed = Object.fromEntries(Object.entries(input).reverse());
    const second = await buildTables(reversed, docker, () => {});
    const source = {repo: 'upsun/meta', ref: 'fixture', commit: 'abc'};
    render(first, source).should.equal(render(second, source));
    first.IMAGES.python.versions['2.7'].should.eql({status: 'retired', eol: '2020-01-01'});
    const module = {exports: {}};
    new Function('module', render(first, source))(module);
    Object.isFrozen(module.exports.IMAGES.valkey.versions['9.0']).should.equal(true);
    Object.isFrozen(module.exports.SOURCE).should.equal(true);
  });
});

describe('Upsun registry runtime lookup', () => {
  const target = {kind: 'service', name: 'database', type: 'postgresql', version: '12'};
  for (const [status, code] of [['deprecated', 'upsun-version-deprecated'], ['retired', 'upsun-version-retired'],
    ['decommissioned', 'upsun-version-retired']]) {
    it(`warns about ${status} versions with the caveats URL`, () => {
      const data = {postgresql: {docs: '', versions: {'12': {status, eol: '2024-11-21'}}}};
      const warning = getLifecycleWarning(target, data);
      warning.code.should.equal(code);
      warning.message.should.equal(`Upsun marks postgresql:12 (service "database") as ${status}; ` +
        'upstream end of life was 2024-11-21.');
      warning.data.should.eql({...target, status, eol: '2024-11-21'});
      toLandoWarning(warning).url.should.equal(`https://docs.lando.dev/upsun/caveats.html#${code}`);
      toLandoWarning(warning).title.should.equal(`Upsun version ${status === 'deprecated' ? 'deprecated' : 'retired'}`);
    });
  }

  it('omits EOL text when unavailable and resolves aliases without changing warning identity', () => {
    const warning = getLifecycleWarning({...target, type: 'postgres-replica'},
      {postgresql: {docs: '', versions: {'12': {status: 'retired'}}}});
    warning.message.should.equal('Upsun marks postgres-replica:12 (service "database") as retired.');
    getPinnedTag('valkey-persistent', '9.0', {valkey: {'9.0': '9.0.6'}}).should.equal('9.0.6');
    for (const [type, expected] of [['redis-persistent', 'redis'], ['mariadb-replica', 'mariadb'],
      ['postgresql-replica', 'postgresql'], ['postgres-replica', 'postgresql']]) {
      registryType(type).should.equal(expected);
    }
  });

  it('never warns for supported, incoming, unknown statuses, versions or types', () => {
    for (const status of ['supported', 'incoming', 'new-status']) {
      chai.expect(getLifecycleWarning(target, {postgresql: {docs: '', versions: {'12': {status}}}})).to.equal(null);
    }
    chai.expect(getLifecycleWarning(target, {})).to.equal(null);
    chai.expect(getLifecycleWarning(target, {postgresql: {docs: '', versions: {}}})).to.equal(null);
    chai.expect(getPinnedTag('valkey', '9', {valkey: {'9.0': '9.0.6'}})).to.equal(undefined);
  });
});
