'use strict';

const chai = require('chai');
chai.should();
const {mapService} = require('../lib/mapping');
const {getMailpitDefinition} = require('../lib/mapping/services');

const makeService = (name, type, version, configuration = {}, raw = {}) => ({
  name,
  type: {service: type, version},
  configuration,
  raw,
});

const emptyModel = {applications: {}, services: {}, routes: {}};

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
      if (['mariadb', 'mysql', 'oracle-mysql', 'postgresql', 'mongodb', 'mongodb-enterprise'].includes(upsunType)) {
        mapped.services.service.creds.should.have.keys('user', 'password', 'database');
        mapped.hostMap.service.should.include({username: 'upsun', password: 'upsun', path: 'main'});
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
    mapped.hostMap.db.should.include({username: 'reporter', password: 'upsun', path: 'analytics'});
    mapped.hostMap['db#reporter'].should.eql(mapped.hostMap.db);
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
  const cases = [
    ['opensearch', '2.19', 'opensearchproject/opensearch:2.19', 'http', 9200, ['9200']],
    ['valkey', '8.0', 'valkey/valkey:8.0', 'redis', 6379, ['6379']],
    ['rabbitmq', '4.1', 'rabbitmq:4.1-management', 'amqp', 5672, ['5672', '15672']],
    ['kafka', '4.0', 'apache/kafka:4.0', 'kafka', 9092, ['9092']],
    ['influxdb', '2.7', 'influxdb:2.7', 'http', 8086, ['8086']],
    ['chrome-headless', '132', 'chromedp/headless-shell:132', 'http', 9222, ['9222']],
    ['gotenberg', '8', 'gotenberg/gotenberg:8', 'http', 3000, ['3000']],
    ['clickhouse', '25', 'clickhouse/clickhouse-server:25', 'http', 8123, ['8123', '9000']],
    ['mercure', '0.16', 'dunglas/mercure:latest', 'http', 80, ['80']],
    ['chroma', '0.6', 'chromadb/chroma:0.6', 'http', 8000, ['8000']],
    ['qdrant', '1.12', 'qdrant/qdrant:v1.12', 'http', 6333, ['6333', '6334']],
  ];

  for (const [type, version, image, scheme, port, ports] of cases) {
    it(`preserves the ${type} image startup command`, () => {
      for (const requested of [version, '', '0']) {
        const mapped = mapService(makeService('service', type, requested), emptyModel);
        const command = mapped.services.service.services.command;
        chai.expect(command, `${type} startup command`).to.be.an('array').that.is.not.empty;
        command[0].should.match(/^(\/|docker-entrypoint\.sh$|tini$|dumb-init$|caddy$)/);
      }
    });

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
      mapService(makeService('queue', 'rabbitmq', version), emptyModel)
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
    const mapped = mapService(makeService('hub', 'mercure', ''), emptyModel).services.hub.services;
    mapped.image.should.equal('dunglas/mercure:latest');
    mapped.environment.should.eql({
      MERCURE_PUBLISHER_JWT_KEY: '!ChangeThisMercureHubJWTSecretKey!',
      MERCURE_SUBSCRIBER_JWT_KEY: '!ChangeThisMercureHubJWTSecretKey!',
    });
    mapService(makeService('vectors', 'qdrant', '0'), emptyModel)
        .services.vectors.services.image.should.equal('qdrant/qdrant:latest');
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

  it('warns and omits vault-kms and unknown services', () => {
    for (const type of ['vault-kms', 'unknown']) {
      const mapped = mapService(makeService('secret', type, '1'), emptyModel);
      mapped.services.should.eql({});
      mapped.hostMap.should.eql({});
      mapped.warnings[0].code.should.equal('service-unsupported');
    }
  });
});
