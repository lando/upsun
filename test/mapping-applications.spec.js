'use strict';

const chai = require('chai');
chai.should();
const {mapApplication} = require('../lib/mapping');

const model = {applications: {}, services: {}, routes: {}};

const baseApp = (runtime, version) => ({
  name: 'app',
  sourceRoot: 'src',
  type: {runtime, version},
  relationships: {database: {service: 'db', endpoint: 'mysql'}},
  mounts: {},
  web: {locations: {}, commands: {start: 'npm start'}, document_root: ''},
  hooks: {build: '', deploy: '', post_deploy: ''},
  workers: {},
  dependencies: {},
  build: {flavor: 'none'},
});

describe('application mapping', () => {
  it('maps PHP locations, dependencies, hooks, mounts, and workers', () => {
    const app = {
      ...baseApp('php', '8.4'),
      web: {
        document_root: 'web',
        commands: {start: null},
        locations: {'/': {root: 'web', passthru: true, index: ['index.php'], scripts: true}},
      },
      dependencies: {
        php: {'composer/composer': '^2'},
        nodejs: {yarn: '^1.22', pnpm: true},
      },
      hooks: {build: 'composer install', deploy: 'bin/deploy', post_deploy: 'bin/warm'},
      mounts: {
        '/var': {source: 'storage', source_path: 'var'},
        '/shared': {source: 'service', service: 'files'},
        '/scratch': {source: 'tmp'},
      },
      workers: {
        queue: {
          commands: {start: 'php bin/worker'},
          relationships: {cache: {service: 'redis', endpoint: 'redis'}},
          mounts: {'/queue': {source: 'local', source_path: 'queue'}},
        },
      },
    };
    const mapped = mapApplication(app, model, {xdebug: 'debug'});
    const definition = mapped.services.app;

    definition.type.should.equal('php:8.4');
    definition.via.should.equal('nginx');
    definition.webroot.should.equal('web');
    definition.composer_version.should.equal('2');
    definition.xdebug.should.equal('debug');
    definition.ssl.should.equal(true);
    definition.environment.should.eql({});
    definition.build.should.eql([
      'npm install -g pnpm',
      'npm install -g yarn@^1.22',
      '/helpers/upsun-hook.sh build',
    ]);
    definition.run.should.eql(['/helpers/upsun-hook.sh deploy', '/helpers/upsun-hook.sh post_deploy']);
    definition.volumes.should.eql([
      'upsun-app-var:/app/src/var',
      'files:/app/src/shared',
      {type: 'tmpfs', target: '/app/src/scratch'},
    ]);
    definition.upsun.locations['/'].should.include({root: 'web', passthru: '/index.php'});
    definition.upsun.index.should.eql(['index.php']);

    const worker = mapped.services['app--queue'];
    worker.command.should.equal('php bin/worker');
    worker.via.should.equal('cli');
    worker.ssl.should.equal(false);
    worker.should.not.have.property('port');
    worker.should.not.have.property('ports');
    worker.volumes.should.include('upsun-app-queue:/app/src/queue');
    worker.upsun.relationships.should.have.keys('database', 'cache');
    mapped.warnings.should.eql([]);
  });

  it('detects composer build flavor without a PHP dependency', () => {
    const app = {...baseApp('php', '8.3'), build: {flavor: 'composer'}};
    mapApplication(app, model).services.app.composer_version.should.equal('2');
  });

  it('runs the default build flavor before the build hook', () => {
    const php = {...baseApp('php', '8.3'), build: {}, hooks: {build: 'echo hi'}};
    mapApplication(php, model).services.app.build.should.eql([
      'composer install --no-interaction --no-progress --prefer-dist --optimize-autoloader',
      '/helpers/upsun-hook.sh build',
    ]);
    const node = {...baseApp('nodejs', '22'), build: {}};
    mapApplication(node, model).services.app.build[0].should.include('npm install');
    const none = {...baseApp('php', '8.3'), build: {flavor: 'none'}};
    mapApplication(none, model).services.app.should.not.have.property('build');
  });

  it('maps Node and the other bundled application runtimes', () => {
    const expected = {
      nodejs: 'node:20',
      python: 'python:3.13',
      ruby: 'ruby:3.4',
      golang: 'go:1.24',
    };
    for (const [runtime, type] of Object.entries(expected)) {
      const app = baseApp(runtime, type.split(':')[1]);
      const definition = mapApplication(app, model).services.app;
      definition.should.include({type, command: 'npm start', port: 8888, ssl: true});
    }
  });

  it('adds dependency and hook steps while disabling a Node worker web port', () => {
    const app = {
      ...baseApp('nodejs', '20'),
      dependencies: {nodejs: {n: '*'}},
      hooks: {build: 'npm ci', deploy: 'npm run deploy', post_deploy: ''},
      workers: {queue: {commands: {start: 'npm run queue'}}},
    };
    const mapped = mapApplication(app, model);
    mapped.services.app.build.should.eql(['npm install -g n', '/helpers/upsun-hook.sh build']);
    mapped.services.app.run.should.eql(['/helpers/upsun-hook.sh deploy']);
    mapped.services['app--queue'].should.include({command: 'npm run queue', port: false, ssl: false});
  });

  it('returns a warning and no service for unsupported runtimes', () => {
    for (const runtime of ['java', 'dotnet', 'elixir', 'rust', 'lisp']) {
      const mapped = mapApplication(baseApp(runtime, '1'), model);
      mapped.services.should.eql({});
      mapped.warnings[0].code.should.equal('runtime-unsupported');
      mapped.warnings[0].data.runtime.should.equal(runtime);
    }
  });
});
