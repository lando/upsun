'use strict';

const chai = require('chai');
chai.should();
const {mapService} = require('../lib/mapping');
const {getMailpitDefinition} = require('../lib/mapping/services');
const {defaultEndpoint} = require('../lib/config/relationships');

const makeService = (name, type, version, configuration = {}, raw = {}) => ({
  name,
  type: {service: type, version},
  configuration,
  raw,
});

const emptyModel = {applications: {}, services: {}, routes: {}};

describe('replica service mapping', () => {
  for (const [type, primaryType, scheme, port, defaultName] of [
    ['mariadb-replica', 'mariadb', 'mysql', 3306, 'mysql'],
    ['mariadb-replica', 'mysql', 'mysql', 3306, 'mysql'],
    ['postgresql-replica', 'postgresql', 'pgsql', 5432, 'postgresql'],
    ['postgres-replica', 'postgresql', 'pgsql', 5432, 'postgresql'],
  ]) {
    it(`maps ${type} endpoints onto ${primaryType} without a container`, () => {
      const service = makeService('replica', type, '16', {endpoints: {
        other: {default_schema: 'other'}, main: {default_schema: 'main', default_database: 'main'},
      }}, {relationships: {primary: {service: 'db', endpoint: 'replicator'}}});
      const model = {...emptyModel, services: {db: makeService('db', primaryType, '16')},
        applications: {app: {relationships: {reader: {service: 'replica', endpoint: 'main'}}}}};
      const mapped = mapService(service, model);
      mapped.services.should.eql({});
      Object.keys(mapped.hostMap).should.eql(['replica#main', 'replica#other', 'replica']);
      mapped.hostMap.replica.should.include({host: 'db', port, scheme, username: 'replica_main',
        password: 'upsun', path: 'main'});
      mapped.hostMap['replica#other'].username.should.equal('replica_other');
      service.configuration = {};
      mapService(service, model).hostMap.replica.should.include({host: 'db', username: `replica_${defaultName}`});
    });
  }

  it('warns and maps nothing for missing, unknown, and incompatible primaries', () => {
    for (const primary of [undefined, 'missing:replicator', 'db:replicator']) {
      const service = makeService('replica', 'mariadb-replica', '16', {}, {relationships: {primary}});
      const mapped = mapService(service, {...emptyModel, services: {db: makeService('db', 'postgresql', '16')}});
      mapped.services.should.eql({});
      mapped.hostMap.should.eql({});
      mapped.warnings[0].should.include({code: 'replica-primary-invalid'});
      mapped.warnings[0].data.should.eql({service: 'replica', primary: primary?.split(':')[0]});
    }
  });

  it('warns about mismatched versions but still maps the replica', () => {
    const service = makeService('replica', 'postgresql-replica', '15', {},
        {relationships: {primary: 'db:replicator'}});
    const mapped = mapService(service, {...emptyModel, services: {db: makeService('db', 'postgresql', '16')}});
    mapped.hostMap.replica.host.should.equal('db');
    mapped.warnings.map(warning => warning.code).should.include('replica-version-mismatch');
  });
});

describe('bundled service mapping', () => {
  it('leaves path null for endpoints without a default database and picks a container default schema', () => {
    for (const [type, version, key] of [['mariadb', '11.4', 'schemas'], ['postgresql', '16', 'databases']]) {
      for (const [configuration, expected] of [
        [{[key]: ['main', 'legacy'], endpoints: {reader: {privileges: {legacy: 'ro'}}, other: {}}}, 'legacy'],
        [{[key]: ['configured'], endpoints: {reader: {}}}, 'configured'],
        [{endpoints: {reader: {}}}, 'main'],
      ]) {
        const mapped = mapService(makeService('db', type, version, configuration), emptyModel);
        chai.expect(mapped.hostMap['db#reader'].path).to.equal(null);
        mapped.services.db.creds.database.should.equal(expected);
        const warnings = mapped.warnings.filter(warning => warning.code === 'relationship-path-null');
        warnings.should.have.length(Object.keys(configuration.endpoints).length);
      }
    }
  });

  const cases = [
    ['mariadb', '11.4', 'mariadb:11.4', 'mysql', 3306],
    ['mysql', '11.4', 'mariadb:11.4', 'mysql', 3306],
    ['oracle-mysql', '8.4', 'mysql:8.4', 'mysql', 3306],
    ['postgresql', '16', 'postgres:16', 'pgsql', 5432],
    ['redis', '7.2', 'redis:7.2', 'redis', 6379],
    ['redis-persistent', '7.2', 'redis:7.2', 'redis', 6379],
    ['memcached', '1.6', 'memcached:1.6', 'memcached', 11211],
    ['mongodb', '7.0', 'mongo:7.0', 'mongodb', 27017],
    ['mongodb-enterprise', '7.0', 'mongo:7.0', 'mongodb', 27017],
    ['solr', '9.6', 'solr:9.6', 'solr', 8983],
    ['elasticsearch', '8.4', 'elasticsearch:8.4.x', 'http', 9200],
    ['elasticsearch-enterprise', '8.4', 'elasticsearch:8.4.x', 'http', 9200],
  ];

  for (const [upsunType, version, landoType, scheme, port] of cases) {
    it(`maps ${upsunType} to ${landoType}`, () => {
      const mapped = mapService(makeService('service', upsunType, version), emptyModel);
      mapped.services.service.type.should.equal(landoType);
      mapped.hostMap.service.should.include({host: 'service', scheme, port});
      mapped.warnings.should.eql([]);
      if (['mariadb', 'mariadb-replica', 'mysql', 'oracle-mysql', 'postgresql', 'postgres-replica',
        'postgresql-replica'].includes(upsunType)) {
        mapped.services.service.creds.should.have.keys('user', 'password', 'database');
        mapped.hostMap.service.should.include({username: 'upsun', password: 'upsun', path: 'main'});
      } else if (upsunType.startsWith('mongodb')) {
        mapped.services.service.should.not.have.property('creds');
        mapped.hostMap.service.should.include({username: null, password: null, path: 'main'});
      }
    });
  }

  it('enables persistence and host port forwarding where supported', () => {
    const redis = mapService(makeService('cache', 'redis-persistent', '7.2'), emptyModel).services.cache;
    redis.should.include({persist: true, portforward: true});
    mapService(makeService('db', 'mariadb', '11.4'), emptyModel).services.db.portforward.should.equal(true);
  });

  it('uses Solr endpoint cores and relationship paths', () => {
    const service = makeService('search', 'solr', '9.6', {endpoints: {main: {core: 'products'}}});
    const mapped = mapService(service, emptyModel);
    mapped.services.search.core.should.equal('products');
    mapped.hostMap.search.path.should.equal('solr/products');
    mapService(makeService('array', 'solr', '9.6', {cores: ['docs']}), emptyModel)
        .services.array.core.should.equal('docs');
    mapService(makeService('object', 'solr', '9.6', {cores: {catalog: {}}}), emptyModel)
        .services.object.core.should.equal('catalog');
  });

  it('warns when multiple Solr cores or endpoints collapse to the first core', () => {
    for (const configuration of [
      {cores: ['products', 'docs']}, {cores: {products: {}, docs: {}}},
      {endpoints: {main: {core: 'products'}, secondary: {core: 'docs'}}},
    ]) {
      const mapped = mapService(makeService('search', 'solr', '9.6', configuration), emptyModel);
      mapped.services.search.core.should.equal('products');
      mapped.warnings.should.deep.include({
        code: 'solr-cores-collapsed',
        message: 'Solr service search defines 2 cores; only products is created locally',
        data: {service: 'search', cores: 2, core: 'products'},
      });
    }
  });

  it('names ignored Redis and Valkey configuration keys without warning on persistence', () => {
    for (const [type, version] of [['redis', '7.2'], ['redis-persistent', '7.2'],
      ['valkey', '8.0'], ['valkey-persistent', '8.0']]) {
      const configuration = {maxmemory_policy: 'allkeys-lru', custom: true, persistence: true};
      const mapped = mapService(makeService('cache', type, version, configuration), emptyModel);
      mapped.warnings.map(warning => warning.code).should.eql(['service-config-ignored', 'service-config-ignored']);
      mapped.warnings.map(warning => warning.data.key).should.eql(['maxmemory_policy', 'custom']);
      mapped.warnings[0].message.should.include('configuration.maxmemory_policy');
    }
  });

  it('maps relationship-selected MariaDB endpoints and schemas', () => {
    const service = makeService('db', 'mariadb', '11.4', {
      schemas: ['main', 'legacy'],
      endpoints: {
        admin: {default_schema: 'main', privileges: {main: 'admin', legacy: 'admin'}},
        importer: {default_schema: 'legacy', privileges: {legacy: 'rw'}},
      },
    });
    const model = {
      ...emptyModel,
      applications: {app: {relationships: {imports: {service: 'db', endpoint: 'importer'}}}},
    };
    const mapped = mapService(service, model);
    mapped.services.db.creds.should.eql({user: 'importer', password: 'upsun', database: 'legacy'});
    mapped.hostMap.db.should.eql({
      host: 'db', port: 3306, scheme: 'mysql', username: 'importer', password: 'upsun',
      path: 'legacy', query: {is_master: true},
    });
    mapped.hostMap['db#importer'].should.eql(mapped.hostMap.db);
    mapped.hostMap['db#admin'].should.include({username: 'admin', path: 'main'});
  });

  it('maps PostgreSQL endpoint default databases', () => {
    const service = makeService('db', 'postgresql', '16', {
      databases: ['main', 'analytics'],
      endpoints: {reporter: {default_database: 'analytics', privileges: {analytics: 'ro'}}},
    });
    const mapped = mapService(service, emptyModel);
    mapped.hostMap.db.should.include({username: 'reporter', password: 'upsun', path: 'analytics'});
    mapped.hostMap['db#reporter'].should.eql(mapped.hostMap.db);
  });

  it('does not warn about intentionally database-less replication endpoints', () => {
    for (const [type, version, replicator] of [
      ['postgresql', '16', {replication: true}],
      ['mariadb', '11.4', {privileges: {main: 'replication'}}],
    ]) {
      const service = makeService('db', type, version, {endpoints: {replicator}});
      const mapped = mapService(service, emptyModel);
      mapped.warnings.should.eql([]);
      mapped.hostMap['db#replicator'].should.include({username: 'replicator'});
      chai.expect(mapped.hostMap['db#replicator'].path).to.equal(null);
      mapped.services.db.creds.database.should.equal('main');
    }
  });

  it('honours supplied supported service versions', () => {
    const mapped = mapService(makeService('db', 'postgresql', '16'), emptyModel, {versions: {postgres: ['15']}});
    mapped.services.db.type.should.equal('postgres:15');
    mapped.warnings[0].code.should.equal('version-unsupported');
  });

  it('uses configured SQL schemas when no custom endpoint exists', () => {
    const maria = makeService('maria', 'mariadb', '11.4', {schemas: ['commerce']});
    mapService(maria, emptyModel).hostMap.maria.path.should.equal('commerce');
    const postgres = makeService('postgres', 'postgresql', '16', {schemas: ['legacy']});
    mapService(postgres, emptyModel).hostMap.postgres.path.should.equal('legacy');
  });

  it('derives Varnish backends from routes and preserves a supported VCL path', () => {
    const service = makeService('edge', 'varnish', '6.0', {vcl: {type: 'string', path: 'config.vcl'}});
    const model = {
      ...emptyModel,
      applications: {app: {}, admin: {}},
      routes: {'https://{default}/': {upstream: 'edge:http'}},
    };
    const mapped = mapService(service, model);
    mapped.services.edge.should.eql({
      type: 'varnish:6.0',
      backends: ['app', 'admin'],
      config: {vcl: 'config.vcl'},
    });
    mapped.hostMap.edge.should.eql({host: 'edge', port: 80, scheme: 'http'});
  });

  it('warns when a VCL include cannot be represented', () => {
    const service = makeService('edge', 'varnish', '6.0', {vcl: {type: 'yaml', value: {}}});
    mapService(service, emptyModel).warnings[0].code.should.equal('varnish-vcl-ignored');
  });

  it('uses string and object Varnish relationships as explicit backends', () => {
    const service = makeService('edge', 'varnish', '6.0', {}, {
      relationships: {main: 'app:http', dashboard: {service: 'admin', endpoint: 'http'}},
    });
    mapService(service, emptyModel).services.edge.backends.should.eql(['app', 'admin']);
  });
});

describe('compose service mapping', () => {
  it('rejects InfluxDB 3 and later without advertising a broken service or relationship', () => {
    for (const version of ['3', '3.0', '3.2.1', '4.0']) {
      const mapped = mapService(makeService('metrics', 'influxdb', version), emptyModel);
      mapped.services.should.eql({});
      mapped.hostMap.should.eql({});
      mapped.warnings[0].should.include({code: 'version-unsupported',
        message: 'InfluxDB 3 is not supported locally yet'});
    }
  });

  it('uses full pinned tags before latest conversion, including persistent aliases', () => {
    const tags = {kafka: {'4.3': '4.3.1'}, valkey: {'9.0': '9.0.6'}, mercure: {'0': 'v0.24.2'}};
    for (const [type, version, image] of [
      ['kafka', '4.3', 'apache/kafka:4.3.1'],
      ['valkey-persistent', '9.0', 'valkey/valkey:9.0.6'],
      ['mercure', '0', 'dunglas/mercure:v0.24.2'],
    ]) {
      mapService(makeService('service', type, version), emptyModel, {tags})
          .services.service.services.image.should.equal(image);
    }
  });

  it('mounts a named data volume and enables append-only writes for persistent Valkey', () => {
    const service = makeService('cache', 'valkey-persistent', '8.0');

    const definition = mapService(service, emptyModel).services.cache;

    definition.volumes.should.eql({data_cache: {}});
    definition.services.volumes.should.eql(['data_cache:/data']);
    definition.services.command.should.eql([
      'tini', '--', 'docker-entrypoint.sh', 'valkey-server', '--appendonly', 'yes',
    ]);
  });

  it('leaves plain Valkey without persistent storage or append-only writes', () => {
    const service = makeService('cache', 'valkey', '8.0');

    const definition = mapService(service, emptyModel).services.cache;

    chai.expect(definition).not.to.have.property('volumes');
    chai.expect(definition.services).not.to.have.property('volumes');
    definition.services.command.should.eql(['tini', '--', 'docker-entrypoint.sh', 'valkey-server']);
  });

  const cases = [
    ['opensearch', '2.19', 'opensearchproject/opensearch:2.19', 'http', 9200, ['9200']],
    ['valkey', '8.0', 'valkey/valkey:8.0', 'redis', 6379, ['6379']],
    ['valkey-persistent', '8.0', 'valkey/valkey:8.0', 'redis', 6379, ['6379']],
    ['rabbitmq', '4.1', 'rabbitmq:4.1-management', 'amqp', 5672, ['5672', '15672']],
    ['kafka', '4.0', 'apache/kafka:4.0', 'kafka', 9092, ['9092']],
    ['influxdb', '2.7', 'influxdb:2.7', 'http', 8086, ['8086']],
    ['chrome-headless', '132', 'chromedp/headless-shell:132', 'http', 9222, ['9222']],
    ['gotenberg', '8', 'gotenberg/gotenberg:8', 'http', 3000, ['3000']],
    ['clickhouse', '25', 'clickhouse/clickhouse-server:25', 'http', 8123, ['8123', '9000']],
    ['mercure', '0.16', 'dunglas/mercure:latest', 'http', 80, ['80']],
  ];

  for (const [type, version, image, scheme, port, ports] of cases) {
    it(`preserves the ${type} image startup command`, () => {
      for (const requested of [version, '', '0']) {
        const mapped = mapService(makeService('service', type, requested), emptyModel, {tags: {}});
        const command = mapped.services.service.services.command;
        chai.expect(command, `${type} startup command`).to.be.an('array').that.is.not.empty;
        command[0].should.match(/^(\/|docker-entrypoint\.sh$|tini$|dumb-init$|caddy$)/);
      }
    });

    it(`maps ${type} through the compose plugin`, () => {
      const mapped = mapService(makeService('service', type, version), emptyModel, {tags: {}});
      mapped.services.service.type.should.equal('compose');
      mapped.services.service.app_mount.should.equal(false);
      mapped.services.service.services.image.should.equal(image);
      mapped.services.service.services.ports.should.eql(ports);
      mapped.hostMap.service.should.include({host: 'service', scheme, port});
      mapped.warnings.should.eql([]);
    });
  }

  it('preserves inspected entrypoints and arguments rather than only daemon arguments', () => {
    const commands = {
      'rabbitmq': ['docker-entrypoint.sh', 'rabbitmq-server'],
      'opensearch': ['/usr/share/opensearch/opensearch-docker-entrypoint.sh', 'opensearch'],
      'kafka': ['/__cacert_entrypoint.sh', '/etc/kafka/docker/run'],
      'chrome-headless': ['/headless-shell/run.sh'],
    };
    for (const [type, command] of Object.entries(commands)) {
      chai.expect(mapService(makeService('service', type, ''), emptyModel)
          .services.service.services.command).to.eql(command);
    }
  });

  it('uses the published unversioned RabbitMQ management tag', () => {
    for (const version of ['', '0', 'latest']) {
      mapService(makeService('queue', 'rabbitmq', version), emptyModel, {tags: {}})
          .services.queue.services.image.should.equal('rabbitmq:management');
    }
  });

  it('sets OpenSearch single-node security environment', () => {
    const environment = mapService(makeService('search', 'opensearch', '2.19'), emptyModel)
        .services.search.services.environment;
    environment.should.eql({
      'discovery.type': 'single-node',
      'DISABLE_SECURITY_PLUGIN': 'true',
      'OPENSEARCH_INITIAL_ADMIN_PASSWORD': 'UpsunLando1!',
    });
  });

  it('sets Mercure JWT keys and latest tags for empty versions', () => {
    const mapped = mapService(makeService('hub', 'mercure', ''), emptyModel, {tags: {}}).services.hub.services;
    mapped.image.should.equal('dunglas/mercure:latest');
    mapped.environment.should.eql({
      MERCURE_PUBLISHER_JWT_KEY: '!ChangeThisMercureHubJWTSecretKey!',
      MERCURE_SUBSCRIBER_JWT_KEY: '!ChangeThisMercureHubJWTSecretKey!',
    });
    mapService(makeService('pdf', 'gotenberg', '0'), emptyModel, {tags: {}})
        .services.pdf.services.image.should.equal('gotenberg/gotenberg:latest');
  });

  it('sets RabbitMQ relationship credentials', () => {
    mapService(makeService('queue', 'rabbitmq', '4.1'), emptyModel).hostMap.queue.should.eql({
      host: 'queue', port: 5672, scheme: 'amqp', username: 'guest', password: 'guest',
    });
  });

  it('sets Kafka KRaft single-node environment and Chrome DevTools command', () => {
    const kafka = mapService(makeService('events', 'kafka', '4.0'), emptyModel).services.events.services;
    kafka.environment.KAFKA_PROCESS_ROLES.should.equal('broker,controller');
    kafka.environment.KAFKA_CONTROLLER_QUORUM_VOTERS.should.equal('1@events:9093');
    const chrome = mapService(makeService('chrome', 'chrome-headless', '132'), emptyModel)
        .services.chrome.services;
    chrome.command.should.eql(['/headless-shell/run.sh']);
  });

  it('no longer returns volumes for network storage', () => {
    mapService(makeService('files', 'network-storage', '1'), emptyModel).should.eql({
      services: {}, hostMap: {}, warnings: [],
    });
  });

  it('builds the mailpit definition and mail URL', () => {
    getMailpitDefinition({mailFrom: ['app', 'app--worker'], host: 'example.lndo.site'}).should.eql({
      services: {
        mailpit: {
          type: 'mailpit',
          mailFrom: ['app', 'app--worker'],
          port: 25,
          overrides: {environment: {MP_SMTP_BIND_ADDR: '0.0.0.0:25'}},
        },
      },
      proxy: {mailpit: [{hostname: 'mail.example.lndo.site', port: '80', pathname: '/'}]},
    });
  });

  // Upsun documents Chroma and Qdrant as applications, not service types, so `type: chroma` is invalid there.
  it('warns and omits vault-kms, unknown services and the vector databases Upsun runs as apps', () => {
    for (const type of ['vault-kms', 'unknown', 'chroma', 'qdrant']) {
      const mapped = mapService(makeService('secret', type, '1'), emptyModel);
      mapped.services.should.eql({});
      mapped.hostMap.should.eql({});
      mapped.warnings[0].code.should.equal('service-unsupported');
    }
  });

  // Every service type Upsun documents, per https://docs.upsun.com/add-services.md (Flex) and
  // https://fixed.docs.upsun.com/add-services.md (Fixed, which is the same list minus clickhouse).
  // A type missing here means a new Upsun service will silently arrive unmapped, so the list is
  // checked against the mapper and the endpoint table together.
  const UPSUN_SERVICE_TYPES = [
    'chrome-headless', 'clickhouse', 'elasticsearch', 'elasticsearch-enterprise', 'gotenberg', 'influxdb',
    'kafka', 'mariadb', 'mariadb-replica', 'memcached', 'mercure', 'mongodb', 'mongodb-enterprise', 'mysql',
    'network-storage', 'opensearch', 'oracle-mysql', 'postgres-replica', 'postgresql', 'postgresql-replica', 'rabbitmq',
    'redis', 'redis-persistent', 'solr', 'valkey', 'valkey-persistent', 'varnish', 'vault-kms',
  ];
  // Types with no local counterpart on purpose: a KMS has nothing to run, and network-storage is
  // mount directories rather than a container.
  const UNSUPPORTED = new Set(['vault-kms', 'network-storage']);

  it('maps every documented Upsun service type that has a local counterpart', () => {
    const missing = UPSUN_SERVICE_TYPES.filter(type => {
      if (UNSUPPORTED.has(type)) return false;
      const service = makeService('svc', type, type === 'influxdb' ? '2.7' : '3', {},
          {relationships: {primary: 'db:replicator'}});
      const model = {...emptyModel, services: {db: makeService('db', type === 'mariadb-replica' ?
        'mariadb' : 'postgresql', '3')}};
      const mapped = mapService(service, model);
      return Object.keys(mapped.services).length === 0 && Object.keys(mapped.hostMap).length === 0;
    });
    missing.should.eql([]);
  });

  it('gives every mapped service type a default relationship endpoint', () => {
    const silent = UPSUN_SERVICE_TYPES.filter(type => {
      if (UNSUPPORTED.has(type)) return false;
      return defaultEndpoint(type) === null;
    });
    silent.should.eql([]);
  });
});
