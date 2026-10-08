'use strict';

const {parse: parseRelationships} = require('./relationships');

const PRIMARY_RUNTIMES = ['php', 'nodejs', 'python', 'ruby', 'golang', 'java', 'elixir'];

const stringList = values => [...new Set(
  (Array.isArray(values) ? values : []).filter(value => typeof value === 'string'),
)];

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
    scripts: location?.scripts ?? true,
    allow: location?.allow ?? true,
    rules: {...(location?.rules || {})},
    expires: location?.expires ?? -1,
    headers: {...(location?.headers || {})},
  },
]));

const normalizeComposable = (app, channel, warnings) => {
  const legacy = Array.isArray(app.stack);
  const stack = legacy ? app.stack : app.stack?.runtimes || [];
  const runtimes = [];
  const packages = legacy ? [] : stringList(app.stack?.packages);
  for (const entry of Array.isArray(stack) ? stack : []) {
    const descriptor = typeof entry === 'string' ? entry : Object.keys(entry || {})[0];
    if (!descriptor) continue;
    const [runtime, version] = descriptor.split('@');
    if (!PRIMARY_RUNTIMES.includes(runtime)) {
      if (legacy) packages.push(descriptor);
      continue;
    }
    const rawOptions = typeof entry === 'object' ? entry[descriptor] : {};
    const options = {...(rawOptions || {})};
    if (Object.hasOwn(options, 'extensions')) options.extensions = stringList(options.extensions);
    if (Object.hasOwn(options, 'disabled_extensions')) {
      options.disabled_extensions = stringList(options.disabled_extensions);
    }
    runtimes.push({runtime, version: version || '', options});
  }
  const primary = runtimes[0] || {runtime: '', version: ''};
  const ignored = runtimes.slice(1)
    .map(entry => entry.runtime)
    .filter(runtime => !(primary.runtime === 'php' && runtime === 'nodejs'));
  if (ignored.length > 0) {
    warnings.push({
      code: 'composable-runtime-picked',
      message: `Application ${app.name} uses composable runtime ${primary.runtime}; ` +
        'additional runtimes are not emulated.',
      data: {app: app.name, runtime: primary.runtime, ignored},
    });
  }
  return {
    type: {runtime: primary.runtime, version: primary.version},
    composable: {channel, runtimes, packages: stringList(packages)},
  };
};

const normalizeOperations = operations => Object.fromEntries(
  Object.entries(operations || {}).map(([name, operation]) => [name, {
    role: typeof operation?.role === 'string' ? operation.role : null,
    commands: {start: typeof operation?.commands?.start === 'string' ? operation.commands.start : null},
  }]),
);

const normalizeWorkers = (workers, services, flavor, warnings, applications) => Object.fromEntries(
  Object.entries(workers || {}).map(([name, worker]) => {
    const parsed = parseRelationships(worker.relationships || {}, services, applications);
    warnings.push(...parsed.warnings);
    return [name, {
      ...worker,
      commands: {start: worker.commands?.start || null},
      relationships: parsed.relationships,
      mounts: normalizeMounts(worker.mounts, flavor),
    }];
  }),
);

const normalizeApplication = (name, app, services, flavor, warnings, applications) => {
  const [runtime, version] = splitType(app.type);
  const application = runtime === 'composable' ? normalizeComposable({...app, name}, version, warnings) : {
    type: {runtime, version}, composable: null,
  };
  const relationships = parseRelationships(app.relationships || {}, services, applications);
  warnings.push(...relationships.warnings);
  const locations = normalizeLocations(app.web?.locations);
  const documentLocation = Object.entries(locations)
    .sort(([left], [right]) => left.length - right.length)[0]?.[1];
  const composablePhp = application.composable?.runtimes.find(entry => entry.runtime === 'php')?.options || {};
  const rawRuntime = {...(app.runtime || {})};
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
      commands: {
        pre_start: typeof app.web?.commands?.pre_start === 'string' ? app.web.commands.pre_start : null,
        start: typeof app.web?.commands?.start === 'string' ? app.web.commands.start : null,
        post_start: typeof app.web?.commands?.post_start === 'string' ? app.web.commands.post_start : null,
      },
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
    workers: normalizeWorkers(app.workers, services, flavor, warnings, applications),
    operations: normalizeOperations(app.operations),
    additional_hosts: {...(app.additional_hosts || {})},
    variables: {env: {}, ...(app.variables || {})},
    dependencies: {...(app.dependencies || {})},
    runtime: {
      ...rawRuntime,
      extensions: stringList([...stringList(rawRuntime.extensions), ...(composablePhp.extensions || [])]),
      disabled_extensions: stringList([
        ...stringList(rawRuntime.disabled_extensions),
        ...(composablePhp.disabled_extensions || []),
      ]),
    },
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
    entries.find(([, route]) => route.type === 'upstream');
  return Object.fromEntries(entries.map(([url, route]) => [url, {
    type: route.type,
    upstream: route.upstream || null,
    to: route.to || null,
    primary: selected?.[0] === url,
    id: route.id || null,
    cache: {...(route.cache || {})},
    attributes: {...(route.attributes || {})},
    ssi: typeof route.ssi === 'object' && route.ssi !== null ? {...route.ssi} : {enabled: route.ssi === true},
    redirects: {...(route.redirects || {})},
    tls: {...(route.tls || {})},
    http_access: {...(route.http_access || {})},
    raw: route,
  }]));
};

/**
 * Normalize a raw configuration triple into the shared Upsun Model fields.
 *
 * @param {import('./config.types').RawConfig} raw Raw configuration.
 * @param {import('./config.types').UpsunFlavor} flavor Configuration flavor.
 * @returns {import('./config.types').NormalizedConfig}
 */
const normalize = (raw, flavor) => {
  const warnings = [];
  const services = normalizeServices(raw.services);
  const applications = Object.fromEntries(Object.entries(raw.applications || {}).map(([name, app]) => [
    name, normalizeApplication(name, app, services, flavor, warnings, raw.applications),
  ]));
  return {applications, services, routes: normalizeRoutes(raw.routes), warnings};
};

exports.normalize = normalize;
