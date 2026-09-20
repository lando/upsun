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
 * @param {object} relationships Raw relationships block.
 * @param {object} services Services keyed by name.
 * @returns {{relationships: object, warnings: object[]}}
 */
const parse = (relationships = {}, services = {}) => {
  const result = {};
  const warnings = [];
  for (const [name, value] of Object.entries(relationships || {})) {
    const legacy = typeof value === 'string' ? value.split(':') : null;
    const service = legacy ? legacy[0] : value?.service || name;
    const target = services[service];
    const explicitEndpoint = legacy ? legacy[1] : value?.endpoint;
    const endpoint = explicitEndpoint || (target ? defaultEndpoint(serviceType(target), name) : null);
    result[name] = {service, endpoint};
    if (!target) {
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
