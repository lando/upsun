'use strict';

const path = require('path');
const {resolveVersion} = require('./versions');

const RUNTIME_TYPES = Object.freeze({
  php: 'php',
  nodejs: 'node',
  python: 'python',
  ruby: 'ruby',
  golang: 'go',
});

const normalizeLocations = locations => Object.fromEntries(Object.entries(locations || {}).map(([route, location]) => [
  route,
  {
    root: location.root || '',
    passthru: location.passthru === true ? '/index.php' : location.passthru || null,
    index: Array.isArray(location.index) ? [...location.index] : [],
    scripts: location.scripts !== false,
    allow: location.allow !== false,
    rules: {...(location.rules || {})},
    expires: location.expires ?? -1,
    headers: {...(location.headers || {})},
  },
]));

const mountSlug = mountPath => mountPath.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'root';

const mapMounts = (app, mounts) => Object.entries(mounts || {}).map(([mountPath, mount]) => {
  const target = path.posix.join('/app', app.sourceRoot || '', mountPath);
  if (mount.source === 'tmp') return {type: 'tmpfs', target};
  const source = mount.source === 'service' ? mount.service : `upsun-${app.name}-${mountSlug(mountPath)}`;
  return `${source}:${target}`;
});

const dependencyBuild = app => Object.entries(app.dependencies?.nodejs || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .filter(([, version]) => version !== false && version !== null)
    .map(([name, version]) => {
      const suffix = version === true || version === '*' || version === 'latest' ? '' : `@${version}`;
      return `npm install -g ${name}${suffix}`;
    });

// Upsun's default build flavor runs `composer install` (php) or `npm install` (nodejs) before hooks.build.
// PHP defaults to composer; Node's default flavor is `default` (npm) unless set to `none`.
const flavorBuild = app => {
  const flavor = app.build?.flavor;
  if (app.type.runtime === 'php' && (flavor === undefined || flavor === 'composer')) {
    return ['composer install --no-interaction --no-progress --prefer-dist --optimize-autoloader'];
  }
  if (app.type.runtime === 'nodejs' && (flavor === undefined || flavor === 'default')) {
    return ['if [ -f package.json ]; then npm install --no-audit --no-fund; fi'];
  }
  return [];
};

const hookSteps = hooks => ({
  build: hooks?.build ? ['/helpers/upsun-hook.sh build'] : [],
  run: ['deploy', 'post_deploy']
      .filter(name => hooks?.[name])
      .map(name => `/helpers/upsun-hook.sh ${name}`),
});

const composerVersion = app => {
  const composer = app.dependencies?.php?.['composer/composer'];
  if (typeof composer === 'string' && /(^|[^0-9])2(?:\D|$)/.test(composer)) return '2';
  return app.build?.flavor === 'composer' ? '2' : undefined;
};

const warningForRuntime = app => ({
  code: 'runtime-unsupported',
  message: `Upsun runtime ${app.type.runtime} is not supported by a bundled Lando service plugin.`,
  data: {app: app.name, runtime: app.type.runtime, version: String(app.type.version)},
});

const createDefinition = (app, opts, landoType, version) => {
  const steps = hookSteps(app.hooks);
  const build = [...dependencyBuild(app), ...flavorBuild(app), ...steps.build];
  const common = {
    type: `${landoType}:${version}`,
    ssl: true,
    volumes: mapMounts(app, app.mounts),
    upsun: {
      locations: normalizeLocations(app.web?.locations),
      relationships: {...(app.relationships || {})},
    },
  };

  if (landoType === 'php') {
    const definition = {
      ...common,
      via: 'nginx',
      webroot: app.web?.document_root || '.',
      xdebug: opts.xdebug ?? false,
      environment: {},
    };
    const composer = composerVersion(app);
    if (composer) {
      definition.composer_version = composer;
    }
    if (app.web?.locations?.['/']?.passthru) {
      definition.upsun.passthru = app.web.locations['/'].passthru === true ?
        '/index.php' : app.web.locations['/'].passthru;
    }
    if (app.web?.locations?.['/']?.index) {
      definition.upsun.index = [...app.web.locations['/'].index];
    }
    if (build.length) {
      definition.build = build;
    }
    if (steps.run.length) {
      definition.run = steps.run;
    }
    return definition;
  }

  const definition = {
    ...common,
    command: app.web?.commands?.start || null,
    port: 8888,
  };
  if (build.length) {
    definition.build = build;
  }
  if (steps.run.length) {
    definition.run = steps.run;
  }
  return definition;
};

/**
 * Maps an Upsun application runtime and workers to Lando service definitions.
 *
 * @param {object} app Normalized model application.
 * @param {object} opts Mapping options.
 * @returns {{services: object, warnings: object[]}}
 */
const mapRuntime = (app, opts = {}) => {
  const landoType = RUNTIME_TYPES[app.type.runtime];
  if (!landoType) return {services: {}, warnings: [warningForRuntime(app)]};

  const resolved = resolveVersion(landoType, app.type.version);
  const definition = createDefinition(app, opts, landoType, resolved.version);
  const services = {[app.name]: definition};

  for (const [workerName, worker] of Object.entries(app.workers || {})) {
    const workerApp = {
      ...app,
      mounts: {...(app.mounts || {}), ...(worker.mounts || {})},
      relationships: {...(app.relationships || {}), ...(worker.relationships || {})},
    };
    const workerDef = createDefinition(workerApp, opts, landoType, resolved.version);
    workerDef.command = worker.commands?.start || null;
    workerDef.ssl = false;
    if (landoType === 'php') {
      workerDef.via = 'cli';
      delete workerDef.port;
    } else {
      workerDef.port = false;
    }
    delete workerDef.ports;
    services[`${app.name}--${workerName}`] = workerDef;
  }

  return {services, warnings: resolved.warning ? [resolved.warning] : []};
};

exports.mapRuntime = mapRuntime;
