'use strict';

const chai = require('chai');
chai.should();
const {mapApplication} = require('../lib/mapping');
const {load} = require('../lib/config');
const path = require('path');

const model = {applications: {}, services: {}, routes: {}};

const baseApp = (runtime, version) => ({
  name: 'app',
  sourceRoot: 'src',
  type: {runtime, version},
  composable: null,
  relationships: {database: {service: 'db', endpoint: 'mysql'}},
  mounts: {},
  web: {
    locations: {},
    commands: {pre_start: null, start: runtime === 'php' ? null : 'npm start', post_start: null},
    document_root: '',
  },
  hooks: {build: '', deploy: '', post_deploy: ''},
  operations: {},
  additional_hosts: {},
  runtime: {extensions: [], disabled_extensions: []},
  workers: {},
  crons: {},
  dependencies: {},
  build: {flavor: 'none'},
});

describe('application mapping', () => {
  it('routes each multiapp PHP vhost to its own FPM service', () => {
    const multiapp = load(path.join(__dirname, 'fixtures/flex-multiapp'));
    for (const app of Object.values(multiapp.applications)) {
      app.type = {runtime: 'php', version: '8.4'};
      app.web.commands.start = null;
    }
    const web = mapApplication(multiapp.applications.web, multiapp).services.web;
    web.config.vhosts.should.include('fastcgi_pass web:9000;');
    for (const app of Object.values(multiapp.applications).filter(app => app.type.runtime === 'php')) {
      mapApplication(app, multiapp).services[app.name].config.vhosts
          .should.include(`fastcgi_pass ${app.name}:9000;`);
    }
  });

  it('keeps valid numeric worker and cron ports outside Node', () => {
    for (const [runtime, version] of [['python', '3.12'], ['ruby', '3.3'], ['golang', '1.22'], ['nodejs', '22']]) {
      const app = {...baseApp(runtime, version), workers: {queue: {commands: {start: 'run'}}},
        crons: {tick: {spec: '* * * * *', commands: {start: 'date'}}}};
      const services = mapApplication(app, model, {crons: true}).services;
      for (const role of ['queue', 'cron']) {
        if (runtime === 'nodejs') services[`app--${role}`].port.should.equal(false);
        else services[`app--${role}`].port.should.be.a('number').and.equal(8888);
      }
    }
  });

  it('preserves exact Composer pins and maps major constraints', () => {
    for (const [wanted, version] of [['2.2.12', '2.2.12'], ['1', '1'], ['1-latest', '1-latest'],
      ['2-latest', '2-latest'], ['^2', '2'], ['~1.10', '1']]) {
      const app = {...baseApp('php', '8.4'), dependencies: {php: {'composer/composer': wanted}}};
      const mapped = mapApplication(app, model);
      mapped.services.app.composer_version.should.equal(version);
      mapped.services.app.build.should.eql([]);
      mapped.warnings.should.eql([]);
    }
    const app = {...baseApp('php', '8.4'), build: {flavor: 'composer'}};
    mapApplication(app, model).services.app.composer_version.should.equal('2');
    app.dependencies = {php: {'composer/composer': '>=1 <3'}};
    const mapped = mapApplication(app, model);
    mapped.warnings.map(warning => warning.code).should.include('version-fallback');
    mapped.services.app.composer_version.should.equal('2');
  });

  it('installs Node for PHP dependencies and skips Python dependencies without a Python image', () => {
    const app = {...baseApp('php', '8.4'), dependencies: {nodejs: {yarn: '*'}, python: {yq: '3.4.3'}}};
    const mapped = mapApplication(app, model);
    mapped.services.app.build_as_root.should.include('/helpers/upsun-install-node.sh 22');
    mapped.services.app.build.should.eql(['npm install -g yarn']);
    mapped.warnings.map(warning => warning.code).should.include('dependency-runtime-missing');
    app.composable = {runtimes: [{runtime: 'php', version: '8.4'}, {runtime: 'nodejs', version: '20'}]};
    const steps = mapApplication(app, model).services.app.build_as_root;
    steps.filter(step => step.startsWith('/helpers/upsun-install-node.sh')).should.eql([
      '/helpers/upsun-install-node.sh 20',
    ]);
    const python = {...baseApp('python', '3.12'), dependencies: {python: {yq: '3.4.3'}}};
    mapApplication(python, model).services.app.build.should.eql(['pip install --user yq==3.4.3']);
    mapApplication(python, model).warnings.should.eql([]);
  });

  it('warns about PHP start commands and non-PHP Unix web sockets', () => {
    const php = baseApp('php', '8.4');
    php.web.commands.start = 'custom-server';
    mapApplication(php, model).warnings.map(warning => warning.code).should.include('web-upstream-unsupported');
    const node = baseApp('nodejs', '22');
    node.web.upstream = {socket_family: 'unix'};
    mapApplication(node, model).warnings.map(warning => warning.code).should.include('web-upstream-unsupported');
  });

  it('runs automatic build flavors in the nested source directory', () => {
    for (const runtime of ['php', 'nodejs']) {
      const app = {...baseApp(runtime, runtime === 'php' ? '8.4' : '22'), sourceRoot: 'backend', build: {}};
      mapApplication(app, model).services.app.build[0].should.match(/^cd '\/app\/backend' && /);
      app.sourceRoot = '';
      mapApplication(app, model).services.app.build[0].should.match(/^if /);
    }
  });

  it('quotes source paths and rejects injected secondary runtime versions', () => {
    const app = {...baseApp('php', '8.4'), sourceRoot: 'backend; echo $(touch x)',
      composable: {runtimes: [{runtime: 'php', version: '8.4'}, {runtime: 'nodejs', version: '22; echo x'}]}};
    (() => mapApplication(app, model)).should.throw('Invalid Node.js version');
    app.composable = null;
    mapApplication(app, model).services.app.build_as_root[1]
        .should.include('\'/app/backend; echo $(touch x)/php.ini\'');
  });

  it('maps a PHP app with sidecar proxy, ini, env-setup and build steps', () => {
    const app = {
      ...baseApp('php', '8.4'),
      web: {
        document_root: 'web',
        commands: {pre_start: null, start: null, post_start: 'echo post'},
        locations: {'/': {root: 'web', passthru: true, index: ['index.php'], scripts: true}},
      },
      variables: {php: {memory_limit: '256M'}},
      runtime: {extensions: ['xsl', 'blackfire'], disabled_extensions: ['imap']},
      dependencies: {
        php: {'composer/composer': '^2', 'phpunit/phpunit': '^11'},
        python: {yq: '3.4.3'},
        ruby: {rake: '*'},
      },
      hooks: {build: 'composer install', deploy: 'bin/deploy', post_deploy: 'bin/warm'},
      build: {flavor: 'composer'},
      additional_hosts: {'example.internal': '127.0.0.1'},
    };
    const mapped = mapApplication(app, model, {xdebug: 'debug'});
    const definition = mapped.services.app;

    definition.should.include({
      type: 'php:8.4',
      via: 'nginx',
      webroot: 'src/web',
      composer_version: '2',
      xdebug: 'debug',
      ssl: true,
    });
    definition.config.vhosts.should.include('fastcgi_pass app:9000;');
    definition.config.php.should.include('memory_limit = 256M');
    definition.build_as_root.should.eql([
      'apt-get -o Acquire::Retries=3 update && apt-get -o Acquire::Retries=3 install -y jq',
      '/helpers/upsun-php-extensions.sh --enable xsl --disable imap',
      'if [ -f \'/app/src/php.ini\' ]; then ln -sf \'/app/src/php.ini\' ' +
        '/usr/local/etc/php/conf.d/zzz-upsun-app.ini; fi',
      'printf \'sendmail_path = "/helpers/mailpit sendmail -t --smtp-addr mailpit:25"\\n\' > ' +
        '/usr/local/etc/php/conf.d/zzzz-upsun-mail.ini',
    ]);
    definition.build.should.eql([
      'composer global require phpunit/phpunit:^11',
      'gem install rake',
      'cd \'/app/src\' && ' +
      'if [ -f composer.json ]; then composer --no-ansi --no-interaction install --no-progress --prefer-dist ' +
        '--optimize-autoloader; fi',
      '/helpers/upsun-hook.sh build',
    ]);
    definition.should.not.have.property('volumes');
    definition.should.not.have.property('run');
    definition.should.not.have.property('environment');
    definition.upsun.proxy.should.eql({service: 'app_nginx', port: 80});
    definition.overrides.extra_hosts.should.eql(['example.internal:127.0.0.1']);
    mapped.warnings.should.deep.include({
      code: 'php-extension-unsupported',
      message: 'PHP extension blackfire cannot be installed locally and is skipped.',
      data: {app: 'app', extension: 'blackfire'},
    });
    mapped.warnings.map(warning => warning.code).should.include('dependency-runtime-missing');
  });

  it('wraps non-PHP apps in the start script and adds clients', () => {
    const definition = mapApplication(baseApp('nodejs', '22'), model).services.app;

    definition.should.include({command: '/helpers/upsun-start.sh', port: 8888, ssl: true});
    definition.build_as_root.should.eql([
      'apt-get -o Acquire::Retries=3 update && ' +
        'apt-get -o Acquire::Retries=3 install -y mariadb-client postgresql-client jq rsync openssh-client',
    ]);
    definition.upsun.proxy.should.eql({service: 'app', port: 8888});
  });

  it('adds an nginx sidecar for non-PHP apps with locations', () => {
    const app = {
      ...baseApp('nodejs', '22'),
      web: {
        document_root: 'public',
        commands: {pre_start: null, start: null, post_start: null},
        locations: {'/': {root: 'public', passthru: '/index.html', rules: {
          '^/nested': {passthru: true}, '^/alternate': {passthru: '/fallback.html'},
        }}},
      },
    };
    const services = mapApplication(app, model).services;

    services.app_nginx.should.include({type: 'nginx', ssl: true, webroot: 'src/public'});
    services.app_nginx.config.vhosts.should.be.a('string').and.not.equal('');
    services.app.upsun.proxy.should.eql({service: 'app_nginx', port: 80});
    services.app.upsun.static.should.equal(true);
    const vhost = services.app_nginx.config.vhosts;
    vhost.should.include('try_files $uri $uri/ /index.html$is_args$args;');
    vhost.should.include('location ~ ^/nested {\n            try_files $uri /index.html$is_args$args;');
    vhost.should.include('location ~ ^/alternate {\n            try_files $uri /fallback.html$is_args$args;');
    vhost.should.not.include('proxy_pass');
    vhost.should.not.include('fastcgi_pass');
    vhost.should.not.include('location ~ \\.php');
    app.web.commands.start = 'node server.js';
    const dynamic = mapApplication(app, model).services;
    dynamic.app.upsun.static.should.equal(false);
    dynamic.app_nginx.config.vhosts.should.include('proxy_pass http://app:8888;');
    dynamic.app_nginx.config.vhosts.should.include('try_files $uri $uri/ @upsun_upstream;');
    dynamic.app_nginx.config.vhosts.should.not.include('fastcgi_pass');
  });

  it('clones workers with env-setup steps but no build or hooks', () => {
    const php = {
      ...baseApp('php', '8.4'),
      runtime: {extensions: ['xsl'], disabled_extensions: []},
      workers: {queue: {commands: {start: 'php bin/worker'}, relationships: {}, mounts: {}}},
    };
    const phpServices = mapApplication(php, model).services;
    const phpWorker = phpServices['app--queue'];

    phpWorker.build.should.eql([]);
    phpWorker.build_as_root.should.eql(phpServices.app.build_as_root);
    phpWorker.command.should.equal('/helpers/upsun-start.sh');
    phpWorker.overrides.environment.PLATFORM_APP_COMMAND.should.equal('php bin/worker');
    phpWorker.should.include({via: 'cli', ssl: false});
    phpWorker.should.not.have.property('port');

    const node = {
      ...baseApp('nodejs', '22'),
      workers: {queue: {commands: {start: 'node worker.js'}, relationships: {}, mounts: {}}},
    };
    mapApplication(node, model).services['app--queue'].port.should.equal(false);
  });

  it('adds a cron sidecar only when requested', () => {
    const app = {
      ...baseApp('php', '8.4'),
      crons: {tick: {spec: '* * * * *', commands: {start: 'date'}}},
    };

    mapApplication(app, model).services.should.not.have.property('app--cron');
    const cron = mapApplication(app, model, {crons: true}).services['app--cron'];
    cron.should.include({command: '/helpers/upsun-crond.sh', ssl: false});
    cron.build.should.eql([]);
    cron.build_as_root.at(-1).should.equal('/helpers/upsun-install-supercronic.sh');
    cron.should.not.have.nested.property('overrides.environment');
  });

  it('installs a secondary node runtime for composable PHP apps', () => {
    const app = {
      ...baseApp('php', '8.4'),
      composable: {
        channel: '26.05',
        runtimes: [
          {runtime: 'php', version: '8.4', options: {}},
          {runtime: 'nodejs', version: '22', options: {}},
        ],
        packages: [],
      },
    };

    mapApplication(app, model).services.app.build_as_root.should.include('/helpers/upsun-install-node.sh 22');
  });

  it('honours supplied supported versions', () => {
    const mapped = mapApplication(baseApp('php', '8.4'), model, {versions: {php: ['8.3']}});

    mapped.services.app.type.should.equal('php:8.3');
    mapped.warnings.map(warning => warning.code).should.include('version-fallback');
  });

  it('returns a warning and no service for unsupported runtimes', () => {
    const mapped = mapApplication(baseApp('java', '21'), model);

    mapped.services.should.eql({});
    mapped.warnings[0].should.include({code: 'runtime-unsupported'});
    mapped.warnings[0].data.should.include({app: 'app', runtime: 'java', version: '21'});
  });
});
