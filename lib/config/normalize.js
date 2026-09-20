'use strict';

const {parse: parseRelationships} = require('./relationships');

const PRIMARY_RUNTIMES = ['php', 'nodejs', 'python', 'ruby', 'golang', 'java', 'elixir'];

const splitType = type => {
  const separator = String(type || '').indexOf(':');
  return separator === -1 ? [String(type || ''), ''] : [type.slice(0, separator), type.slice(separator + 1)];
};

const normalizeMount = (mount, flavor) => {
  if (typeof mount === 'string' && flavor === 'fixed') {
    const configuredPath = mount.split(':').slice(1).join(':');
    const pathParts = configuredPath.split('/');
    return {source: 'local', source_path: pathParts.slice(1).join('/') || configuredPath, service: null};
  }
  return {
    source: mount?.source || 'local',
    source_path: mount?.source_path || '',
    service: mount?.service || null,
  };
};

const normalizeMounts = (mounts, flavor) => Object.fromEntries(
  Object.entries(mounts || {}).map(([name, mount]) => [name, normalizeMount(mount, flavor)]),
);

const normalizeLocations = locations => Object.fromEntries(Object.entries(locations || {}).map(([route, location]) => [
  route,
  {
    root: location?.root || '',
    passthru: location?.passthru === true ? '/index.php' : location?.passthru || null,
    index: Array.isArray(location?.index) ? [...location.index] : [],
    scripts: location?.scripts !== false,
    allow: location?.allow !== false,
    rules: {...(location?.rules || {})},
    expires: location?.expires ?? -1,
    headers: {...(location?.headers || {})},
  },
]));

const normalizeComposable = (app, channel, warnings) => {
  const stack = Array.isArray(app.stack) ? app.stack : [];
  const runtimes = {};
  for (const entry of stack) {
    const descriptor = typeof entry === 'string' ? entry : Object.keys(entry || {})[0];
    if (!descriptor) continue;
    const [runtime, version] = descriptor.split('@');
    if (PRIMARY_RUNTIMES.includes(runtime)) runtimes[runtime] = version || '';
  }
  const runtime = PRIMARY_RUNTIMES.find(name => Object.hasOwn(runtimes, name)) || '';
  const ignored = Object.keys(runtimes).filter(name => name !== runtime);
  warnings.push({
    code: 'composable-runtime-picked',
    message: `Application ${app.name} uses composable runtime ${runtime}; additional runtimes are not emulated.`,
    data: {app: app.name, runtime, ignored},
  });
  return {
    type: {runtime, version: runtimes[runtime] || ''},
    composable: {channel, runtimes, packages: stack.map(entry => typeof entry === 'object' ? {...entry} : entry)},
  };
};

const normalizeWorkers = (workers, services, flavor, warnings) => Object.fromEntries(
  Object.entries(workers || {}).map(([name, worker]) => {
    const parsed = parseRelationships(worker.relationships || {}, services);
    warnings.push(...parsed.warnings);
    return [name, {
      ...worker,
      commands: {start: worker.commands?.start || null},
      relationships: parsed.relationships,
      mounts: normalizeMounts(worker.mounts, flavor),
    }];
  }),
);

const normalizeApplication = (name, app, services, flavor, warnings) => {
  const [runtime, version] = splitType(app.type);
  const application = runtime === 'composable' ? normalizeComposable({...app, name}, version, warnings) : {
    type: {runtime, version}, composable: null,
  };
  const relationships = parseRelationships(app.relationships || {}, services);
  warnings.push(...relationships.warnings);
  const locations = normalizeLocations(app.web?.locations);
  const documentLocation = Object.entries(locations)
    .sort(([left], [right]) => left.length - right.length)[0]?.[1];
  return {
    name,
    sourceRoot: app.source?.root === '/' ? '' : app.source?.root || '',
    type: application.type,
    composable: application.composable,
    container_profile: app.container_profile || null,
    relationships: relationships.relationships,
    mounts: normalizeMounts(app.mounts, flavor),
    web: {
      locations,
      commands: {pre_start: app.web?.commands?.pre_start || null, start: app.web?.commands?.start || null},
      upstream: {
        socket_family: app.web?.upstream?.socket_family || 'tcp',
        protocol: app.web?.upstream?.protocol || null,
      },
      document_root: locations['/']?.root || documentLocation?.root || '',
    },
    hooks: {
      build: app.hooks?.build || '',
      deploy: app.hooks?.deploy || '',
      post_deploy: app.hooks?.post_deploy || '',
    },
    crons: {...(app.crons || {})},
    workers: normalizeWorkers(app.workers, services, flavor, warnings),
    variables: {env: {}, ...(app.variables || {})},
    dependencies: {...(app.dependencies || {})},
    runtime: {...(app.runtime || {})},
    build: {...(app.build || {})},
    timezone: app.timezone || null,
    raw: app,
  };
};

const normalizeServices = services => Object.fromEntries(Object.entries(services || {}).map(([name, service]) => {
  const [type, version] = splitType(service.type);
  return [name, {
    name,
    type: {service: type, version},
    configuration: {...(service.configuration || {})},
    raw: service,
  }];
}));

const normalizeRoutes = routes => {
  const entries = Object.entries(routes || {});
  const selected = entries.find(([, route]) => route.primary === true) ||
    entries.find(([url, route]) => route.type === 'upstream' && url.includes('{default}')) ||
    entries.find(([, route]) => route.type === 'upstream');
  return Object.fromEntries(entries.map(([url, route]) => [url, {
    type: route.type,
    upstream: route.upstream || null,
    to: route.to || null,
    primary: selected?.[0] === url,
    id: route.id || null,
    cache: {...(route.cache || {})},
    ssi: {...(route.ssi || {})},
    redirects: {...(route.redirects || {})},
    tls: {...(route.tls || {})},
    http_access: {...(route.http_access || {})},
    raw: route,
  }]));
};

/**
 * Normalize a raw configuration triple into the shared Upsun Model fields.
 *
 * @param {{applications: object, services: object, routes: object}} raw Raw configuration.
 * @param {'flex'|'fixed'} flavor Configuration flavor.
 * @returns {{applications: object, services: object, routes: object, warnings: object[]}}
 */
const normalize = (raw, flavor) => {
  const warnings = [];
  const services = normalizeServices(raw.services);
  const applications = Object.fromEntries(Object.entries(raw.applications || {}).map(([name, app]) => [
    name, normalizeApplication(name, app, services, flavor, warnings),
  ]));
  return {applications, services, routes: normalizeRoutes(raw.routes), warnings};
};

exports.normalize = normalize;
