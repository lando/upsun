'use strict';

const {expect} = require('chai');
const {createHash} = require('node:crypto');
const env = require('../lib/env');
const decode = value => JSON.parse(Buffer.from(value, 'base64').toString());
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64');
const route = overrides => ({
  type: 'upstream', upstream: 'app:http', to: null, primary: true, id: 'main',
  tls: {}, cache: {enabled: true}, ssi: {enabled: false}, redirects: {}, raw: {}, ...overrides,
});
const fixture = (flavor = 'flex') => {
  const raw = {
    name: 'old-name', type: 'php:8.4', source: {root: 'backend'},
    relationships: {database: 'db:mysql'}, mounts: {'/files': {source: 'storage', source_path: 'files'}},
    web: {locations: {'/': {root: 'web'}}}, hooks: {build: 'composer install'}, crons: {},
    variables: {env: {GREETING: 'hello'}, php: {memory_limit: '256M'}},
    dependencies: {php: {'composer/composer': '^2'}}, runtime: {extensions: ['redis']}, timezone: 'UTC',
    ...(flavor === 'fixed' ? {size: 'S', disk: 2048} : {container_profile: 'BALANCED'}),
  };
  return {
    flavor, root: '/project', configFiles: [], warnings: [],
    applications: {app: {
      name: 'app', sourceRoot: 'backend', type: {runtime: 'php', version: '8.4'},
      relationships: {database: {service: 'db', endpoint: 'mysql'}},
      variables: raw.variables, web: {document_root: 'web', upstream: {socket_family: 'tcp'}}, raw,
    }},
    services: {db: {name: 'db', type: {service: 'mariadb', version: '11.4'}, configuration: {}, raw: {}}},
    routes: {'https://{default}/': route()},
  };
};
const options = () => ({hostMap: {
  db: {host: 'db', ip: '10.0.0.2', port: 3306, scheme: 'mysql', username: 'upsun', password: 'upsun', path: 'main'},
}});
const expectedRelationship = {
  cluster: 'lando', epoch: 0, fragment: null, host: 'db', host_mapped: false, hostname: 'db', instance_ips: [],
  ip: '10.0.0.2', password: 'upsun', path: 'main', port: 3306, public: false, query: {is_master: true},
  rel: 'mysql', scheme: 'mysql', service: 'db', type: 'mariadb:11.4', username: 'upsun',
};
const expectedService = {
  DATABASE_CLUSTER: 'lando', DATABASE_EPOCH: '0', DATABASE_FRAGMENT: '', DATABASE_HOST: 'db',
  DATABASE_HOST_MAPPED: 'false', DATABASE_HOSTNAME: 'db', DATABASE_INSTANCE_IPS: '[]', DATABASE_IP: '10.0.0.2',
  DATABASE_NAME: 'main', DATABASE_PASSWORD: 'upsun', DATABASE_PATH: 'main', DATABASE_PORT: '3306',
  DATABASE_PUBLIC: 'false', DATABASE_QUERY: '{"is_master":true}', DATABASE_REL: 'mysql', DATABASE_SCHEME: 'mysql',
  DATABASE_SERVICE: 'db', DATABASE_TYPE: 'mariadb:11.4', DATABASE_URL: 'mysql://upsun:upsun@db:3306/main',
  DATABASE_USERNAME: 'upsun',
};
const assertSorted = value => {
  if (Array.isArray(value)) return value.forEach(assertSorted);
  if (value !== null && typeof value === 'object') {
    expect(Object.keys(value)).to.deep.equal(Object.keys(value).sort());
    Object.values(value).forEach(assertSorted);
  }
};

describe('environment contract', () => {
  for (const flavor of ['flex', 'fixed']) {
    it(`emits every runtime variable with exact values for ${flavor}`, () => {
      const model = fixture(flavor);
      const result = env.getRuntimeEnv(model, 'app', options());
      const application = {...model.applications.app.raw, name: 'app'};
      delete application.source;
      expect(decode(result.PLATFORM_APPLICATION)).to.deep.equal(application);
      expect(decode(result.PLATFORM_RELATIONSHIPS)).to.deep.equal({database: [expectedRelationship]});
      const routes = {'https://app.lndo.site/': {
        attributes: {}, cache: {enabled: true}, http_access: {}, id: 'main', original_url: 'https://{default}/',
        primary: true, redirects: {}, ssi: {enabled: false}, tls: {}, to: null, type: 'upstream', upstream: 'app:http',
      }};
      expect(decode(result.PLATFORM_ROUTES)).to.deep.equal(routes);
      expect(result).to.deep.equal({
        ...expectedService, GREETING: 'hello', PLATFORM_APP_DIR: '/app/backend',
        PLATFORM_APPLICATION: result.PLATFORM_APPLICATION, PLATFORM_APPLICATION_NAME: 'app', PLATFORM_BRANCH: 'main',
        PLATFORM_DOCUMENT_ROOT: '/app/backend/web', PLATFORM_ENVIRONMENT: 'lando',
        PLATFORM_ENVIRONMENT_TYPE: 'development', PLATFORM_PROJECT: 'lando',
        PLATFORM_PROJECT_ENTROPY: createHash('sha256').update('app').digest('hex').slice(0, 56),
        PLATFORM_RELATIONSHIPS: encode({database: [expectedRelationship]}), PLATFORM_ROUTES: encode(routes),
        PLATFORM_SMTP_HOST: '', PLATFORM_TREE_ID: createHash('sha1').update('app').digest('hex'),
        PLATFORM_VARIABLES: encode({'php:memory_limit': '256M'}),
        PLATFORM_VENDOR: flavor === 'flex' ? 'upsun' : 'platformsh', PORT: '8888',
      });
      Object.values(result).forEach(value => expect(value).to.be.a('string'));
      assertSorted(result);
      for (const key of ['PLATFORM_APPLICATION', 'PLATFORM_RELATIONSHIPS', 'PLATFORM_ROUTES', 'PLATFORM_VARIABLES']) {
        assertSorted(decode(result[key]));
        expect(encode(decode(result[key]))).to.equal(result[key]);
      }
    });

    it(`emits only build/shared variables and promoted values for ${flavor}`, () => {
      const model = fixture(flavor);
      const build = env.getBuildEnv(model, 'app');
      expect(build).to.deep.equal({
        CI: 'lando', GREETING: 'hello', PLATFORM_APP_DIR: '/app/backend',
        PLATFORM_APPLICATION: encode(env.getApplicationPayload(model, 'app')), PLATFORM_APPLICATION_NAME: 'app',
        PLATFORM_CACHE_DIR: '/tmp/cache', PLATFORM_OUTPUT_DIR: '/app/backend', PLATFORM_PROJECT: 'lando',
        PLATFORM_PROJECT_ENTROPY: env.entropy('app'),
        PLATFORM_TREE_ID: createHash('sha1').update('app').digest('hex'),
        PLATFORM_VARIABLES: encode({'php:memory_limit': '256M'}),
        PLATFORM_VENDOR: flavor === 'flex' ? 'upsun' : 'platformsh',
      });
      assertSorted(build);
    });
  }

  it('uses explicit options in both phases and only exposes SOCKET for unix upstreams', () => {
    const model = fixture();
    const opts = {...options(), domain: 'example.test', projectId: 'project', branch: 'feature', treeId: 'tree',
      environment: 'local', smtpHost: 'mailpit', vendor: 'custom', entropy: 'salt'};
    model.applications.app.web.upstream.socket_family = 'unix';
    const runtime = env.getRuntimeEnv(model, 'app', opts);
    expect(runtime).to.include({
      PLATFORM_BRANCH: 'feature', PLATFORM_ENVIRONMENT: 'local', PLATFORM_SMTP_HOST: 'mailpit',
      PLATFORM_PROJECT: 'project', PLATFORM_TREE_ID: 'tree', PLATFORM_VENDOR: 'custom',
      PLATFORM_PROJECT_ENTROPY: 'salt',
      SOCKET: '/run/app.sock', PORT: '8888'});
    expect(decode(runtime.PLATFORM_ROUTES)).to.have.property('https://app.example.test/');
    expect(env.getBuildEnv(model, 'app', opts)).to.include({
      PLATFORM_PROJECT: 'project', PLATFORM_TREE_ID: 'tree', PLATFORM_VENDOR: 'custom',
      PLATFORM_PROJECT_ENTROPY: 'salt',
    }).and.not.have.property('SOCKET');
    delete model.applications.app.web.upstream.socket_family;
    expect(env.getRuntimeEnv(model, 'app', opts)).not.to.have.property('SOCKET');
  });

  it('promotes complex env values, flattens one namespace level, and protects generated variables', () => {
    const model = fixture();
    model.applications.app.variables = {
      env: {TEXT: 'héllo', COUNT: 3, FLAG: false, NIL: null, LIST: ['a', 'b'], OBJECT: {z: 1, a: 2},
        PLATFORM_PROJECT: 'wrong', DATABASE_HOST: 'wrong'},
      php: {memory_limit: '128M'}, stuff: {nested: {z: 1, a: 2}}, plain: 'value', list: [1, 2], nil: null,
    };
    const result = env.getRuntimeEnv(model, 'app', options());
    expect(result).to.include({TEXT: 'héllo', COUNT: '3', FLAG: 'false', NIL: 'null', LIST: '["a","b"]',
      OBJECT: '{"a":2,"z":1}', PLATFORM_PROJECT: 'lando', DATABASE_HOST: 'db'});
    expect(decode(result.PLATFORM_VARIABLES)).to.deep.equal({
      'php:memory_limit': '128M', 'stuff:nested': {a: 2, z: 1}, 'plain': 'value', 'list': [1, 2], 'nil': null,
    });
  });

  it('handles empty relationships, variables, routes, and source root without a hostMap', () => {
    const model = fixture();
    Object.assign(model.applications.app, {sourceRoot: '', relationships: {}, variables: {}});
    model.applications.app.web.document_root = '';
    model.routes = {};
    expect(env.getRuntimeEnv(model, 'app')).to.include({PLATFORM_APP_DIR: '/app', PLATFORM_DOCUMENT_ROOT: '/app',
      PLATFORM_RELATIONSHIPS: 'e30=', PLATFORM_VARIABLES: 'e30=', PLATFORM_ROUTES: 'e30='});
    expect(env.getRelationshipsPayload(model, 'app')).to.deep.equal({});
    expect(env.getServiceEnv(model, 'app')).to.deep.equal({});
    expect(env.getRoutesPayload(model, 'app')).to.deep.equal({});
  });

  it('fails clearly when a runtime relationship has no mapping but still allows builds', () => {
    expect(() => env.getRelationshipsPayload(fixture(), 'app')).to.throw('Missing hostMap entry for service "db"');
    expect(() => env.getBuildEnv(fixture(), 'app')).not.to.throw();
  });

  for (const [service, scheme, port, credentials] of [
    ['mariadb', 'mysql', 3306, true], ['postgresql', 'pgsql', 5432, true], ['redis', 'redis', 6379, false],
    ['opensearch', 'http', 9200, false], ['memcached', 'memcached', 11211, false],
  ]) {
    it(`emits exact ${service} relationships and all service fields`, () => {
      const model = fixture();
      model.services.db.type = {service, version: '1.0'};
      model.applications.app.relationships = {'my-db': {service: 'db', endpoint: 'custom'}};
      const host = {host: 'db', port, scheme,
        ...(credentials ? {username: 'user', password: 'pass', path: 'data'} : {})};
      const opts = {hostMap: {db: host}};
      const expected = {...expectedRelationship, ip: 'db', port, scheme, type: `${service}:1.0`, rel: 'custom',
        query: credentials ? {is_master: true} : {}};
      for (const field of ['username', 'password', 'path']) {
        delete expected[field];
        if (credentials) expected[field] = host[field];
      }
      expect(env.getRelationshipsPayload(model, 'app', opts)).to.deep.equal({'my-db': [expected]});
      const result = env.getServiceEnv(model, 'app', opts);
      const expectedFields = Object.fromEntries(Object.entries(expected).map(([key, value]) => [
        `MY_DB_${key.toUpperCase()}`,
        value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value),
      ]));
      if (credentials) expectedFields.MY_DB_NAME = 'data';
      const auth = credentials ? 'user:pass@' : '';
      expectedFields.MY_DB_URL = `${scheme}://${auth}db:${port}${credentials ? '/data' : ''}`;
      expect(result).to.deep.equal(expectedFields);
    });
  }

  it('encodes URL credentials and paths, brackets IPv6, and allows password-less usernames', () => {
    const opts = options();
    Object.assign(opts.hostMap.db, {host: '::1', username: 'a@b', password: 'p:/', path: 'a b/data'});
    expect(env.getServiceEnv(fixture(), 'app', opts).DATABASE_URL)
      .to.equal('mysql://a%40b:p%3A%2F@[::1]:3306/a%20b/data');
    delete opts.hostMap.db.password;
    expect(env.getServiceEnv(fixture(), 'app', opts).DATABASE_URL).to.equal('mysql://a%40b:@[::1]:3306/a%20b/data');
  });

  it('isolates applications and emits each relationship, including aliases for the same service', () => {
    const model = fixture();
    model.services.cache = {name: 'cache', type: {service: 'redis', version: '7.2'}, raw: {}, configuration: {}};
    model.applications.other = {...model.applications.app, name: 'other', relationships: {}};
    model.applications.app.relationships = {
      'database': {service: 'db', endpoint: 'mysql'},
      'read.only': {service: 'db', endpoint: 'reader'},
      'cache': {service: 'cache', endpoint: 'redis'},
    };
    const opts = options();
    opts.hostMap.cache = {host: 'cache', scheme: 'redis', port: 6379};
    const payload = env.getRelationshipsPayload(model, 'app', opts);
    expect(Object.keys(payload)).to.deep.equal(['cache', 'database', 'read.only']);
    expect(payload['read.only'][0]).to.deep.equal({...expectedRelationship, rel: 'reader'});
    const runtime = env.getRuntimeEnv(model, 'app', opts);
    expect(runtime).to.include({CACHE_HOST: 'cache', READ_ONLY_REL: 'reader', DATABASE_REL: 'mysql'});
    expect(env.getServiceEnv(model, 'other', opts)).to.deep.equal({});
    expect(env.getApplicationPayload(model, 'other').name).to.equal('other');
  });

  it('keeps canonical query metadata rather than importing mapping query options', () => {
    const opts = options();
    opts.hostMap.db.query = {is_master: false, custom: 'ignored'};
    expect(env.getRelationshipsPayload(fixture(), 'app', opts).database[0].query).to.deep.equal({is_master: true});
  });

  it('resolves route collisions consistently regardless of input insertion order', () => {
    const model = fixture();
    model.routes['https://{all}/'] = route({id: 'all', primary: false});
    expect(env.getRoutesPayload(model, 'app')['https://app.lndo.site/'].id).to.equal('main');
    model.routes = Object.fromEntries(Object.entries(model.routes).reverse());
    expect(env.getRoutesPayload(model, 'app')['https://app.lndo.site/'].id).to.equal('main');
  });

  it('resolves default, all, subdomains, paths, and literal URLs', () => {
    for (const [input, output] of [
      ['https://{default}/', 'https://app.test/'], ['https://www.{default}/a', 'https://www.app.test/a'],
      ['http://{all}/', 'http://app.test/'], ['https://fixed.example/path', 'https://fixed.example/path'],
    ]) expect(env.resolveRouteUrl(input, 'app', 'test')).to.equal(output);
  });

  it('preserves full route metadata and resolves redirects without filtering other app routes', () => {
    const model = fixture();
    model.routes = {
      'https://www.{default}/': route({type: 'redirect', upstream: null, to: 'https://{default}/', primary: false,
        id: null, raw: {http_access: {addresses: ['allow:*']}}}),
      'https://{all}/': route({upstream: 'other:http', tls: {strict_transport_security: {enabled: true}},
        http_access: {basic_auth: {user: 'pass'}}}),
      'http://literal.test/': route({primary: false}),
    };
    const result = env.getRoutesPayload(model, 'app');
    expect(result['https://www.app.lndo.site/']).to.deep.equal({
      type: 'redirect', upstream: null, to: 'https://app.lndo.site/', primary: false, id: null,
      original_url: 'https://www.{default}/', attributes: {}, tls: {}, cache: {enabled: true},
      ssi: {enabled: false}, redirects: {}, http_access: {addresses: ['allow:*']},
    });
    expect(result['https://app.lndo.site/']).to.include({upstream: 'other:http', primary: true,
      original_url: 'https://{all}/'});
    expect(result['https://app.lndo.site/'].http_access).to.deep.equal({basic_auth: {user: 'pass'}});
    expect(result['https://app.lndo.site/'].tls).to.deep.equal({strict_transport_security: {enabled: true}});
    expect(result).to.have.property('http://literal.test/');
    assertSorted(result);
  });

  it('is deterministic, recursively sorted, and does not mutate or share nested input objects', () => {
    const model = fixture();
    const opts = options();
    const before = JSON.stringify({model, opts});
    const first = env.getRuntimeEnv(model, 'app', opts);
    const reverse = value => {
      if (Array.isArray(value)) return value.map(reverse);
      return value !== null && typeof value === 'object' ?
        Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reverse(entry)])) : value;
    };
    expect(JSON.stringify(env.getRuntimeEnv(reverse(model), 'app', reverse(opts)))).to.equal(JSON.stringify(first));
    expect(JSON.stringify(env.getRuntimeEnv(model, 'app', opts))).to.equal(JSON.stringify(first));
    env.getApplicationPayload(model, 'app').web.locations['/'].root = 'changed';
    env.getRoutesPayload(model, 'app')['https://app.lndo.site/'].cache.enabled = false;
    env.getRelationshipsPayload(model, 'app', opts).database[0].query.is_master = false;
    expect(JSON.stringify({model, opts})).to.equal(before);
  });

  it('derives stable 56-character lowercase alphanumeric entropy from UTF-8 SHA-256', () => {
    expect(env.entropy('app')).to.equal(createHash('sha256').update('app').digest('hex').slice(0, 56));
    expect(env.entropy('app')).to.match(/^[a-z0-9]{56}$/);
    expect(env.entropy('app')).not.to.equal(env.entropy('other'));
    expect(env.entropy('é')).to.equal(createHash('sha256').update('é', 'utf8').digest('hex').slice(0, 56));
  });
});
