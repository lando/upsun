'use strict';

const chai = require('chai');
chai.should();
const {mapService} = require('../lib/mapping');

const makeService = (name, type, version, configuration = {}, raw = {}) => ({
  name,
  type: {service: type, version},
  configuration,
  raw,
});

const emptyModel = {applications: {}, services: {}, routes: {}};

describe('bundled service mapping', () => {
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
      if (['mariadb', 'mysql', 'oracle-mysql', 'postgresql', 'mongodb', 'mongodb-enterprise'].includes(upsunType)) {
        mapped.services.service.creds.should.have.keys('user', 'password', 'database');
        if (upsunType === 'postgresql') {
          // Lando's postgres plugin only supports the passwordless postgres superuser
          mapped.hostMap.service.should.include({username: 'postgres', password: '', path: 'main'});
        } else {
          mapped.hostMap.service.should.include({username: 'upsun', password: 'upsun', path: 'main'});
        }
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
    mapped.hostMap.db.should.include({username: 'postgres', path: 'analytics'});
    mapped.hostMap['db#reporter'].should.eql(mapped.hostMap.db);
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
  const cases = [
    ['opensearch', '2.19', 'opensearchproject/opensearch:2.19', 'http', 9200, ['9200']],
    ['valkey', '8.0', 'valkey/valkey:8.0', 'redis', 6379, ['6379']],
    ['rabbitmq', '4.1', 'rabbitmq:4.1-management', 'amqp', 5672, ['5672', '15672']],
    ['kafka', '4.0', 'apache/kafka:4.0', 'kafka', 9092, ['9092']],
    ['influxdb', '2.7', 'influxdb:2.7', 'http', 8086, ['8086']],
    ['chrome-headless', '132', 'chromedp/headless-shell:132', 'http', 9222, ['9222']],
    ['gotenberg', '8', 'gotenberg/gotenberg:8', 'http', 3000, ['3000']],
    ['clickhouse', '25', 'clickhouse/clickhouse-server:25', 'http', 8123, ['8123', '9000']],
  ];

  for (const [type, version, image, scheme, port, ports] of cases) {
    it(`maps ${type} through the compose plugin`, () => {
      const mapped = mapService(makeService('service', type, version), emptyModel);
      mapped.services.service.type.should.equal('compose');
      mapped.services.service.app_mount.should.equal(false);
      mapped.services.service.services.image.should.equal(image);
      mapped.services.service.services.ports.should.eql(ports);
      mapped.hostMap.service.should.include({host: 'service', scheme, port});
      mapped.warnings.should.eql([]);
    });
  }

  it('sets OpenSearch single-node security environment', () => {
    const environment = mapService(makeService('search', 'opensearch', '2.19'), emptyModel)
        .services.search.services.environment;
    environment.should.eql({
      'discovery.type': 'single-node',
      'DISABLE_SECURITY_PLUGIN': 'true',
      'OPENSEARCH_INITIAL_ADMIN_PASSWORD': 'UpsunLando1!',
    });
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
    chrome.command.should.include('--remote-debugging-port=9222');
  });

  it('declares network storage as a top-level named volume', () => {
    mapService(makeService('files', 'network-storage', '1'), emptyModel).should.eql({
      services: {}, volumes: {files: {}}, hostMap: {}, warnings: [],
    });
  });

  it('warns and omits vault-kms and unknown services', () => {
    for (const type of ['vault-kms', 'unknown']) {
      const mapped = mapService(makeService('secret', type, '1'), emptyModel);
      mapped.services.should.eql({});
      mapped.hostMap.should.eql({});
      mapped.warnings[0].code.should.equal('service-unsupported');
    }
  });
});
