'use strict';

const ENDPOINTS = Object.freeze({
  'mariadb': 'mysql',
  'mysql': 'mysql',
  'oracle-mysql': 'mysql',
  'postgresql': 'postgresql',
  'redis': 'redis',
  'valkey': 'valkey',
  'opensearch': 'opensearch',
  'elasticsearch': 'elasticsearch',
  'solr': 'solr',
  'memcached': 'memcached',
  'mongodb': 'mongodb',
  'rabbitmq': 'rabbitmq',
  'kafka': 'kafka',
  'influxdb': 'influxdb',
  'varnish': 'http',
  'chrome-headless': 'http',
  'mercure': 'http',
  'chroma': 'http',
  'qdrant': 'http',
});

/**
 * Return the default endpoint for a service type.
 *
 * @param {string} type Service type.
 * @param {string} [mountName] Network-storage mount name.
 * @returns {string|null}
 */
const defaultEndpoint = (type, mountName) => type === 'network-storage' ? mountName || null : ENDPOINTS[type] || null;

const serviceType = service => {
  if (typeof service?.type === 'string') return service.type.split(':')[0];
  return service?.type?.service;
};

/**
 * Normalize all supported Upsun relationship forms.
 *
 * @param {Record<string, import('./config.types').RawRelationship>} relationships Raw relationships block.
 * @param {Record<string, import('./config.types').UpsunService|import('./config.types').RawService>} services Services keyed by name.
 * @param {Record<string, import('./config.types').RawApplication|import('./config.types').UpsunApplication>} applications Applications keyed by name.
 * @returns {import('./config.types').RelationshipResult}
 */
const parse = (relationships = {}, services = {}, applications = {}) => {
  /** @type {Record<string, import('./config.types').UpsunRelationship>} */
  const result = {};
  const warnings = [];
  for (const [name, value] of Object.entries(relationships || {})) {
    const legacy = typeof value === 'string' ? value.split(':') : null;
    const service = legacy ? legacy[0] : value?.service || name;
    const target = services[service];
    const application = applications[service];
    const explicitEndpoint = legacy ? legacy[1] : value?.endpoint;
    let endpoint = explicitEndpoint;
    if (!endpoint) {
      if (target) endpoint = defaultEndpoint(serviceType(target), name);
      else endpoint = application ? 'http' : null;
    }
    result[name] = {service, endpoint};
    if (!target && !application) {
      warnings.push({
        code: 'relationship-unknown-service',
        message: `Relationship ${name} references unknown service ${service}.`,
        data: {relationship: name, service},
      });
    }
  }
  return {relationships: result, warnings};
};

exports.defaultEndpoint = defaultEndpoint;
exports.parse = parse;
