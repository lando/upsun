'use strict';

const {resolveVersion} = require('./versions');

const BUNDLED = Object.freeze({
  'mariadb': {landoType: 'mariadb', scheme: 'mysql', port: 3306, credentials: true, portforward: true},
  'mysql': {landoType: 'mariadb', scheme: 'mysql', port: 3306, credentials: true, portforward: true},
  'oracle-mysql': {landoType: 'mysql', scheme: 'mysql', port: 3306, credentials: true, portforward: true},
  'postgresql': {landoType: 'postgres', scheme: 'pgsql', port: 5432, credentials: true, portforward: true},
  'redis': {landoType: 'redis', scheme: 'redis', port: 6379, portforward: true},
  'redis-persistent': {landoType: 'redis', scheme: 'redis', port: 6379, persist: true, portforward: true},
  'memcached': {landoType: 'memcached', scheme: 'memcached', port: 11211, portforward: true},
  'mongodb': {landoType: 'mongo', scheme: 'mongodb', port: 27017, credentials: true, portforward: true},
  'mongodb-enterprise': {landoType: 'mongo', scheme: 'mongodb', port: 27017, credentials: true, portforward: true},
  'solr': {landoType: 'solr', scheme: 'solr', port: 8983},
  'elasticsearch': {landoType: 'elasticsearch', scheme: 'http', port: 9200},
  'elasticsearch-enterprise': {landoType: 'elasticsearch', scheme: 'http', port: 9200},
  'varnish': {landoType: 'varnish', scheme: 'http', port: 80},
});

const COMPOSE = Object.freeze({
  'opensearch': {image: 'opensearchproject/opensearch', scheme: 'http', port: 9200,
    command: ['/usr/share/opensearch/opensearch-docker-entrypoint.sh', 'opensearch'], environment: {
    'discovery.type': 'single-node',
    'DISABLE_SECURITY_PLUGIN': 'true',
    'OPENSEARCH_INITIAL_ADMIN_PASSWORD': 'UpsunLando1!',
  }},
  'valkey': {image: 'valkey/valkey', scheme: 'redis', port: 6379, portforward: true,
    command: ['tini', '--', 'docker-entrypoint.sh', 'valkey-server']},
  'rabbitmq': {image: 'rabbitmq', scheme: 'amqp', port: 5672, ports: [5672, 15672],
    username: 'guest', password: 'guest', command: ['docker-entrypoint.sh', 'rabbitmq-server'],
    tag: version => version === 'latest' ? 'management' : `${version}-management`},
  'kafka': {image: 'apache/kafka', scheme: 'kafka', port: 9092, ports: [9092], kafka: true,
    command: ['/__cacert_entrypoint.sh', '/etc/kafka/docker/run']},
  'influxdb': {image: 'influxdb', scheme: 'http', port: 8086, portforward: true,
    command: ['/entrypoint.sh', 'influxd']},
  'chrome-headless': {image: 'chromedp/headless-shell', scheme: 'http', port: 9222, ports: [9222],
    command: ['/headless-shell/run.sh']},
  'gotenberg': {image: 'gotenberg/gotenberg', scheme: 'http', port: 3000,
    command: ['/usr/bin/tini', '--', 'gotenberg']},
  'clickhouse': {image: 'clickhouse/clickhouse-server', scheme: 'http', port: 8123, ports: [8123, 9000],
    portforward: true, command: ['/entrypoint.sh']},
  'mercure': {image: 'dunglas/mercure', scheme: 'http', port: 80, environment: {
    MERCURE_PUBLISHER_JWT_KEY: '!ChangeThisMercureHubJWTSecretKey!',
    MERCURE_SUBSCRIBER_JWT_KEY: '!ChangeThisMercureHubJWTSecretKey!',
  }, tag: () => 'latest', command: ['caddy', 'run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile']},
  'chroma': {image: 'chromadb/chroma', scheme: 'http', port: 8000, tag: version => version,
    command: ['dumb-init', '--', 'chroma', 'run', '/config.yaml']},
  'qdrant': {image: 'qdrant/qdrant', scheme: 'http', port: 6333, ports: [6333, 6334],
    tag: version => version === 'latest' ? version : `v${version}`, command: ['/qdrant/entrypoint.sh']},
});

const hostEntry = (name, config, credentials = {}) => {
  const entry = {host: name, port: config.port, scheme: config.scheme};
  if (credentials.username) entry.username = credentials.username;
  if (credentials.password !== undefined) entry.password = credentials.password;
  if (credentials.path !== undefined) entry.path = credentials.path;
  if (credentials.query) entry.query = credentials.query;
  return entry;
};

const endpointConfig = (service, model, type) => {
  const configuration = service.configuration || {};
  const endpoints = configuration.endpoints || {};
  const endpointNames = Object.keys(endpoints);
  const defaultName = type === 'postgresql' ? 'postgresql' : 'mysql';
  if (endpointNames.length === 0) {
    const databases = configuration.schemas || configuration.databases || ['main'];
    return [{name: defaultName, path: databases[0] || 'main', username: 'upsun'}];
  }

  const relationships = Object.values(model.applications || {}).flatMap(app => Object.values(app.relationships || {}));
  const selected = relationships.find(relationship => relationship.service === service.name)?.endpoint;
  const ordered = selected && endpoints[selected] ?
    [selected, ...endpointNames.filter(name => name !== selected)] :
    endpointNames;
  return ordered.map(name => ({
    name,
    path: type === 'postgresql' ?
      endpoints[name].default_database ?? endpoints[name].default_schema ?? null :
      endpoints[name].default_schema ?? null,
    database: Object.keys(endpoints[name].privileges || {})[0] ||
      configuration.schemas?.[0] || configuration.databases?.[0] || 'main',
    username: name,
  }));
};

const credentialsFor = endpoint => ({username: endpoint.username, password: 'upsun'});

const databaseHostMap = (service, model, config, type) => {
  const endpoints = endpointConfig(service, model, type);
  /** @type {Record<string, import('./mapping.types').HostMapEntry>} */
  const hostMap = {};
  const warnings = [];
  for (const endpoint of endpoints) {
    if (endpoint.path === null) {
      warnings.push({
        code: 'relationship-path-null',
        message: `Endpoint ${endpoint.name} of ${service.name} has no default database; its relationship path is null.`,
        data: {service: service.name, endpoint: endpoint.name},
      });
    }
    hostMap[`${service.name}#${endpoint.name}`] = hostEntry(service.name, config, {
      ...credentialsFor(endpoint),
      path: endpoint.path,
      query: {is_master: true},
    });
  }
  hostMap[service.name] = {...hostMap[`${service.name}#${endpoints[0].name}`]};
  return {hostMap, endpoint: endpoints[0], warnings};
};

const solrCore = service => {
  const configuration = service.configuration || {};
  const endpoint = Object.values(configuration.endpoints || {})[0];
  if (endpoint?.core) return endpoint.core;
  if (Array.isArray(configuration.cores)) return configuration.cores[0] || 'collection1';
  if (configuration.cores && typeof configuration.cores === 'object') {
    return Object.keys(configuration.cores)[0] || 'collection1';
  }
  return 'collection1';
};

const targetName = relationship => {
  if (typeof relationship === 'string') return relationship.split(':')[0];
  return relationship?.service;
};

const varnishBackends = (service, model) => {
  const relationships = service.raw?.relationships || service.relationships || {};
  const names = Object.values(relationships).map(targetName).filter(Boolean);
  const routed = Object.values(model.routes || {}).some(route => route.upstream?.split(':')[0] === service.name);
  if (names.length) return [...new Set(names)];
  return routed ? Object.keys(model.applications || {}) : [];
};

const mapBundled = (service, model, config, opts) => {
  const resolved = resolveVersion(config.landoType, service.type.version, opts.versions?.[config.landoType]);
  const definition = {type: `${config.landoType}:${resolved.version}`};
  if (config.portforward) definition.portforward = true;
  if (config.persist) definition.persist = true;
  let hostMap;
  const warnings = resolved.warning ? [resolved.warning] : [];

  if (config.credentials && ['mariadb', 'mysql', 'oracle-mysql', 'postgresql'].includes(service.type.service)) {
    const database = databaseHostMap(service, model, config, service.type.service);
    hostMap = database.hostMap;
    const creds = credentialsFor(database.endpoint);
    definition.creds = {user: creds.username, password: creds.password,
      database: database.endpoint.path ?? database.endpoint.database};
    warnings.push(...database.warnings);
  } else if (config.credentials) {
    definition.creds = {user: 'upsun', password: 'upsun', database: 'main'};
    hostMap = {[service.name]: hostEntry(service.name, config, {
      username: 'upsun', password: 'upsun', path: 'main',
    })};
  } else if (service.type.service === 'solr') {
    const core = solrCore(service);
    definition.core = core;
    hostMap = {[service.name]: hostEntry(service.name, config, {path: `solr/${core}`})};
  } else {
    hostMap = {[service.name]: hostEntry(service.name, config)};
  }

  if (service.type.service === 'varnish') {
    definition.backends = varnishBackends(service, model);
    const vcl = service.configuration?.vcl;
    if (typeof vcl === 'string' || typeof vcl?.path === 'string') {
      definition.config = {vcl: typeof vcl === 'string' ? vcl : vcl.path};
    } else if (vcl) {
      warnings.push({
        code: 'varnish-vcl-ignored',
        message: `Varnish service ${service.name} has a VCL value Lando cannot map.`,
        data: {service: service.name},
      });
    }
  }

  return {services: {[service.name]: definition}, hostMap, warnings};
};

const composeEnvironment = (service, config) => {
  if (config.kafka) {
    return {
      KAFKA_NODE_ID: '1',
      KAFKA_PROCESS_ROLES: 'broker,controller',
      KAFKA_LISTENERS: 'PLAINTEXT://:9092,CONTROLLER://:9093',
      KAFKA_ADVERTISED_LISTENERS: `PLAINTEXT://${service.name}:9092`,
      KAFKA_CONTROLLER_LISTENER_NAMES: 'CONTROLLER',
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: 'CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT',
      KAFKA_CONTROLLER_QUORUM_VOTERS: `1@${service.name}:9093`,
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: '1',
    };
  }
  return {...(config.environment || {})};
};

const mapCompose = (service, config) => {
  const wanted = String(service.type.version);
  const requested = wanted === '' || wanted === '0' ? 'latest' : wanted;
  const version = config.tag?.(requested) ?? requested;
  const image = `${config.image}:${version}`;
  const compose = {
    image,
    command: [...config.command],
    environment: composeEnvironment(service, config),
    ports: (config.ports || [config.port]).map(port => String(port)),
  };
  const definition = {type: 'compose', app_mount: false, services: compose};
  if (config.portforward) definition.portforward = true;
  return {
    services: {[service.name]: definition},
    hostMap: {[service.name]: hostEntry(service.name, config, {
      username: config.username,
      password: config.password,
    })},
    warnings: [],
  };
};

/**
 * Maps an Upsun service to a bundled Lando plugin or an official compose image.
 *
 * @param {import('../config/config.types').UpsunService} service Normalized model service.
 * @param {import('../config/config.types').UpsunModel} model Complete normalized model.
 * @param {import('./mapping.types').MappingOptions} opts Mapping options.
 * @returns {import('./mapping.types').ServiceMapResult}
 */
const mapModelService = (service, model, opts = {}) => {
  const type = service.type.service;
  if (BUNDLED[type]) return mapBundled(service, model, BUNDLED[type], opts);
  if (COMPOSE[type]) return mapCompose(service, COMPOSE[type]);
  if (type === 'network-storage') {
    return {
      services: {},
      hostMap: {},
      warnings: [],
    };
  }
  return {
    services: {},
    hostMap: {},
    warnings: [{
      code: 'service-unsupported',
      message: `Upsun service ${type} cannot be mapped to a local Lando service.`,
      data: {service: service.name, type, version: String(service.type.version)},
    }],
  };
};

/**
 * Build the local mail service and proxy definition.
 * @param {{mailFrom: string[], host: string}} options Mail sources and local hostname.
 * @returns {{services: import('./mapping.types').MappedServices, proxy: Record<string, import('./mapping.types').ProxyEntry[]>}}
 */
const getMailpitDefinition = ({mailFrom, host}) => ({
  services: {
    mailpit: {
      type: 'mailpit',
      mailFrom,
      port: 25,
      overrides: {environment: {MP_SMTP_BIND_ADDR: '0.0.0.0:25'}},
    },
  },
  proxy: {mailpit: [{hostname: `mail.${host}`, port: '80', pathname: '/'}]},
});

exports.getMailpitDefinition = getMailpitDefinition;
exports.mapModelService = mapModelService;
