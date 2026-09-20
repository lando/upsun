'use strict';

const {createHash} = require('node:crypto');
const path = require('node:path').posix;

// Canonicalize recursively so payload bytes do not depend on insertion order.
const sorted = value => {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
  }
  return value;
};
const encode = value => Buffer.from(JSON.stringify(sorted(value))).toString('base64');
const stringify = value => typeof value === 'object' ? JSON.stringify(sorted(value)) : String(value);
const databaseTypes = new Set(['mariadb', 'mysql', 'oracle-mysql', 'postgresql', 'mongodb', 'influxdb', 'clickhouse']);
const promoted = app => Object.fromEntries(Object.entries(app.variables.env || {})
  .map(([key, value]) => [key, stringify(value)]));
const variables = app => Object.fromEntries(Object.entries(app.variables)
  .filter(([key]) => key !== 'env')
  .flatMap(([key, value]) => value !== null && typeof value === 'object' && !Array.isArray(value) ?
    Object.entries(value).map(([child, entry]) => [`${key}:${child}`, entry]) : [[key, value]]));

/**
 * Return the first 56 hexadecimal characters of SHA-256(seed), encoded as UTF-8.
 * Hexadecimal is a lowercase alphanumeric alphabet; this is a local stable salt, not a secret.
 * @param {string} seed
 * @returns {string}
 */
const entropy = seed => createHash('sha256').update(seed).digest('hex').slice(0, 56);

/**
 * Resolve Upsun domain placeholders, leaving absolute hosts and paths unchanged.
 * @param {string} url
 * @param {string} appName
 * @param {string} domain
 * @returns {string}
 */
const resolveRouteUrl = (url, appName, domain) => url.replace(/\{(?:default|all)\}/g, () => `${appName}.${domain}`);

/**
 * Preserve the Upsun application block, replacing its name and removing source metadata.
 * @param {object} model
 * @param {string} appName
 * @returns {object}
 */
const getApplicationPayload = (model, appName) => {
  const payload = {...model.applications[appName].raw, name: model.applications[appName].name};
  delete payload.source;
  return sorted(payload);
};

/**
 * Produce decoded relationship endpoints using mapping-owned host and credential data.
 * @param {object} model
 * @param {string} appName
 * @param {object} [opts]
 * @returns {object}
 */
const getRelationshipsPayload = (model, appName, opts = {}) => {
  const relationships = Object.entries(model.applications[appName].relationships).map(([name, relationship]) => {
    const {service, endpoint} = relationship;
    const target = model.services[service];
    const host = opts.hostMap?.[`${service}#${endpoint}`] ?? opts.hostMap?.[service];
    if (!host) throw new Error(`Missing hostMap entry for service "${service}" (relationship "${name}")`);
    const entry = {
      service, rel: endpoint, type: `${target.type.service}:${target.type.version}`, cluster: 'lando',
      scheme: host.scheme, host: host.host, hostname: host.host, ip: host.ip ?? host.host, port: host.port,
      query: databaseTypes.has(target.type.service) ? {is_master: true} : {},
      fragment: null, public: false, host_mapped: false, epoch: 0, instance_ips: [],
    };
    for (const field of ['username', 'password', 'path']) {
      if (host[field] !== undefined) entry[field] = host[field];
    }
    return [name, [entry]];
  });
  return sorted(Object.fromEntries(relationships));
};

/**
 * Produce decoded route information, including resolved redirect destinations.
 * @param {object} model
 * @param {string} appName
 * @param {object} [opts]
 * @returns {object}
 */
const getRoutesPayload = (model, appName, opts = {}) => sorted(Object.fromEntries(
  Object.entries(model.routes).sort(([a], [b]) => a.localeCompare(b)).map(([url, route]) => [
    resolveRouteUrl(url, appName, opts.domain ?? 'lndo.site'), {
      type: route.type, upstream: route.upstream, to: route.to === null ? null :
        resolveRouteUrl(route.to, appName, opts.domain ?? 'lndo.site'),
      primary: route.primary, id: route.id, original_url: url, attributes: {},
      tls: route.tls, cache: route.cache, ssi: route.ssi, redirects: route.redirects,
      http_access: route.http_access ?? route.raw.http_access ?? {},
    },
  ]),
));

// Encode URI components without encoding database path separators.
const connectionUrl = entry => {
  const credentials = entry.username ?
    `${encodeURIComponent(entry.username)}:${encodeURIComponent(entry.password ?? '')}@` : '';
  const host = entry.host.includes(':') ? `[${entry.host}]` : entry.host;
  const suffix = entry.path === undefined ? '' : `/${entry.path.split('/').map(encodeURIComponent).join('/')}`;
  return `${entry.scheme}://${credentials}${host}:${entry.port}${suffix}`;
};

/**
 * Expand every relationship field into string-valued service environment variables.
 * NAME aliases PATH; absent optional credentials are not emitted and null FRAGMENT is empty.
 * @param {object} model
 * @param {string} appName
 * @param {object} [opts]
 * @returns {object}
 */
const getServiceEnv = (model, appName, opts = {}) => {
  const result = {};
  for (const [name, [entry]] of Object.entries(getRelationshipsPayload(model, appName, opts))) {
    const prefix = name.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const fields = {...entry, url: connectionUrl(entry), fragment: ''};
    if (entry.path !== undefined) fields.name = entry.path;
    for (const [field, value] of Object.entries(fields)) result[`${prefix}_${field.toUpperCase()}`] = stringify(value);
  }
  return sorted(result);
};

const commonEnv = (model, appName, opts) => {
  const app = model.applications[appName];
  return {
    PLATFORM_APP_DIR: path.join('/app', app.sourceRoot),
    PLATFORM_APPLICATION: encode(getApplicationPayload(model, appName)),
    PLATFORM_APPLICATION_NAME: app.name,
    PLATFORM_PROJECT: opts.projectId ?? 'lando',
    PLATFORM_PROJECT_ENTROPY: opts.entropy ?? entropy(appName),
    PLATFORM_TREE_ID: opts.treeId ?? createHash('sha1').update(appName).digest('hex'),
    PLATFORM_VARIABLES: encode(variables(app)),
    PLATFORM_VENDOR: opts.vendor ?? (model.flavor === 'flex' ? 'upsun' : 'platformsh'),
  };
};

/**
 * Return build-only and shared variables, without resolving runtime service hosts.
 * @param {object} model
 * @param {string} appName
 * @param {object} [opts]
 * @returns {object}
 */
const getBuildEnv = (model, appName, opts = {}) => {
  const shared = commonEnv(model, appName, opts);
  return sorted({
    ...promoted(model.applications[appName]), ...shared,
    CI: 'lando', PLATFORM_CACHE_DIR: '/tmp/cache', PLATFORM_OUTPUT_DIR: shared.PLATFORM_APP_DIR,
  });
};

/**
 * Return the complete local runtime contract; generated values override application variables.
 * @param {object} model
 * @param {string} appName
 * @param {object} [opts]
 * @returns {object}
 */
const getRuntimeEnv = (model, appName, opts = {}) => {
  const app = model.applications[appName];
  const shared = commonEnv(model, appName, opts);
  return sorted({
    ...promoted(app), ...getServiceEnv(model, appName, opts), ...shared,
    PLATFORM_BRANCH: opts.branch ?? 'main',
    PLATFORM_DOCUMENT_ROOT: path.join(shared.PLATFORM_APP_DIR, app.web.document_root),
    PLATFORM_ENVIRONMENT: opts.environment ?? 'lando', PLATFORM_ENVIRONMENT_TYPE: 'development',
    PLATFORM_RELATIONSHIPS: encode(getRelationshipsPayload(model, appName, opts)),
    PLATFORM_ROUTES: encode(getRoutesPayload(model, appName, opts)), PLATFORM_SMTP_HOST: opts.smtpHost ?? '',
    PORT: '8888', ...(app.web.upstream.socket_family === 'unix' ? {SOCKET: '/run/app.sock'} : {}),
  });
};

module.exports = {
  entropy, getApplicationPayload, getBuildEnv, getRelationshipsPayload, getRoutesPayload,
  getRuntimeEnv, getServiceEnv, resolveRouteUrl,
};
