'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const {execFileSync} = require('child_process');
const chai = require('chai');
chai.should();

const {load} = require('../lib/config/index');
const {normalize} = require('../lib/config/normalize');
const UpsunYaml = require('../lib/config/yaml');

const fixture = name => path.join(__dirname, 'fixtures', name);

describe('config model loading', () => {
  it('loads the complete Flex Drupal model', () => {
    const root = fixture('flex-drupal');
    load(root).should.eql({
      flavor: 'flex',
      layout: 'upsun',
      root,
      configFiles: [path.join(root, '.upsun', 'config.yaml')],
      applications: {
        app: {
          name: 'app',
          sourceRoot: '',
          type: {runtime: 'php', version: '8.4'},
          composable: null,
          container_profile: null,
          relationships: {
            database: {service: 'db', endpoint: 'mysql'},
            redis: {service: 'redis', endpoint: 'redis'},
          },
          mounts: {
            '/web/sites/default/files': {source: 'storage', source_path: 'files', service: null},
          },
          web: {
            locations: {'/': {
              root: 'web', passthru: '/index.php', index: ['index.php'], scripts: true,
              allow: true, rules: {}, expires: -1, headers: {},
            }},
            commands: {pre_start: 'php setup.php', start: null, post_start: null},
            upstream: {socket_family: 'unix', protocol: 'fastcgi'},
            document_root: 'web',
          },
          hooks: {build: 'composer install', deploy: 'php deploy.php', post_deploy: ''},
          crons: {queue: {spec: '*/5 * * * *', commands: {start: 'php cron.php'}}},
          workers: {},
          operations: {},
          additional_hosts: {},
          variables: {env: {APP_ENV: 'local'}, php: {memory_limit: '512M'}},
          dependencies: {php: {'composer/composer': '^2'}},
          runtime: {extensions: [], disabled_extensions: []},
          build: {flavor: 'composer'},
          timezone: null,
          raw: {
            type: 'php:8.4', source: {root: '/'},
            relationships: {database: 'db:mysql', redis: null},
            mounts: {'/web/sites/default/files': {source: 'storage', source_path: 'files'}},
            web: {
              locations: {'/': {root: 'web', passthru: true, index: ['index.php']}},
              commands: {pre_start: 'php setup.php'},
              upstream: {socket_family: 'unix', protocol: 'fastcgi'},
            },
            hooks: {build: 'composer install', deploy: 'php deploy.php'},
            crons: {queue: {spec: '*/5 * * * *', commands: {start: 'php cron.php'}}},
            variables: {env: {APP_ENV: 'local'}, php: {memory_limit: '512M'}},
            dependencies: {php: {'composer/composer': '^2'}},
            build: {flavor: 'composer'},
          },
        },
      },
      services: {
        db: {
          name: 'db', type: {service: 'mariadb', version: '11.4'},
          configuration: {schemas: ['main']},
          raw: {type: 'mariadb:11.4', configuration: {schemas: ['main']}},
        },
        redis: {
          name: 'redis', type: {service: 'redis', version: '7.2'}, configuration: {}, raw: {type: 'redis:7.2'},
        },
      },
      routes: {
        'https://{default}/': {
          type: 'upstream', upstream: 'app:http', to: null, primary: true, id: null,
          cache: {}, ssi: {}, redirects: {}, tls: {}, http_access: {},
          raw: {type: 'upstream', upstream: 'app:http'},
        },
      },
      warnings: [],
    });
  });

  it('loads the complete Fixed root model', () => {
    const root = fixture('fixed-root');
    load(root).should.eql({
      flavor: 'fixed',
      layout: 'platform',
      root,
      configFiles: [
        path.join(root, '.platform.app.yaml'),
        path.join(root, '.platform', 'routes.yaml'),
        path.join(root, '.platform', 'services.yaml'),
      ],
      applications: {app: {
        name: 'app', sourceRoot: '', type: {runtime: 'php', version: '8.0'}, composable: null,
        container_profile: null,
        relationships: {database: {service: 'db', endpoint: 'mysql'}},
        mounts: {
          '/web/sites/default/files': {source: 'local', source_path: 'x', service: null},
          '/private': {source: 'local', source_path: 'private', service: null},
        },
        web: {
          locations: {'/': {
            root: 'web', passthru: '/index.php', index: [], scripts: true,
            allow: true, rules: {}, expires: -1, headers: {},
          }},
          commands: {pre_start: null, start: null, post_start: null},
          upstream: {socket_family: 'tcp', protocol: null}, document_root: 'web',
        },
        hooks: {build: '', deploy: '', post_deploy: ''}, crons: {}, workers: {}, operations: {},
        additional_hosts: {}, variables: {env: {}}, dependencies: {},
        runtime: {extensions: [], disabled_extensions: []}, build: {}, timezone: null,
        raw: {
          name: 'app', type: 'php:8.0',
          web: {locations: {'/': {root: 'web', passthru: '/index.php'}}},
          relationships: {database: 'db:mysql'},
          mounts: {
            '/web/sites/default/files': 'shared:files/x',
            '/private': {source: 'local', source_path: 'private'},
          },
          source: {root: ''},
        },
      }},
      services: {db: {
        name: 'db', type: {service: 'mariadb', version: '10.4'}, configuration: {}, raw: {type: 'mariadb:10.4'},
      }},
      routes: {'https://{default}/': {
        type: 'upstream', upstream: 'app:http', to: null, primary: true, id: null,
        cache: {}, ssi: {}, redirects: {}, tls: {}, http_access: {},
        raw: {type: 'upstream', upstream: 'app:http'},
      }},
      warnings: [],
    });
  });

  it('loads Fixed applications.yaml and nested app files with source roots', () => {
    const applications = load(fixture('fixed-applications')).applications;
    applications.web.sourceRoot.should.equal('web');
    applications.api.sourceRoot.should.equal('api');

    const nested = load(fixture('fixed-nested')).applications;
    Object.keys(nested).should.eql(['api', 'frontend']);
    nested.api.sourceRoot.should.equal('api');
    nested.frontend.sourceRoot.should.equal('frontend');
  });

  it('loads .magento/services.yaml and routes.yaml', () => {
    const model = load(fixture('fixed-magento'));
    model.should.include({flavor: 'fixed', layout: 'magento'});
    model.applications.mymagento.sourceRoot.should.equal('');
    model.applications.mymagento.type.should.eql({runtime: 'php', version: '8.3'});
    model.applications.mymagento.relationships.should.eql({
      database: {service: 'mysql', endpoint: 'mysql'},
      redis: {service: 'redis', endpoint: 'redis'},
    });
    model.services.mysql.type.should.eql({service: 'mariadb', version: '10.6'});
    model.services.redis.type.should.eql({service: 'redis', version: '7.2'});
    model.routes['http://{default}/'].should.include({type: 'upstream', upstream: 'mymagento:http'});
  });

  it('loads nested Magento apps without optional services and routes and ignores ece-tools config', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-load-'));
    try {
      fs.writeFileSync(path.join(root, '.magento.env.yaml'), 'not valid: [');
      for (const name of ['api', 'frontend']) {
        fs.mkdirSync(path.join(root, name));
        fs.writeFileSync(path.join(root, name, '.magento.app.yaml'), `name: ${name}\ntype: php:8.3\n`);
      }
      const model = load(root);
      model.should.include({flavor: 'fixed', layout: 'magento'});
      Object.keys(model.applications).should.eql(['api', 'frontend']);
      model.applications.api.sourceRoot.should.equal('api');
      model.applications.frontend.sourceRoot.should.equal('frontend');
      model.services.should.eql({});
      model.routes.should.eql({});
      model.configFiles.should.have.length(2);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('normalizes multi-app workers, redirects, and object relationships', () => {
    const model = load(fixture('flex-multiapp'));
    Object.keys(model.applications).should.eql(['web', 'api']);
    model.applications.web.workers.queue.commands.start.should.equal('npm run queue');
    model.applications.api.relationships.database.should.eql({service: 'db', endpoint: 'reporting'});
    model.routes['https://www.{default}/'].should.include({type: 'redirect', primary: false});
    model.routes['https://{default}/'].primary.should.equal(true);
  });

  it('normalizes post_start, operations, additional_hosts, runtime lists and timezone', () => {
    const model = load(fixture('flex-full'));
    const app = model.applications.app;
    app.web.commands.should.eql({pre_start: null, start: null, post_start: 'echo post'});
    app.operations.should.eql({hello: {role: null, commands: {start: 'echo operation-ran'}}});
    app.additional_hosts.should.eql({'example.internal': '127.0.0.1'});
    app.runtime.should.eql({extensions: ['xsl', 'blackfire'], disabled_extensions: []});
    app.timezone.should.equal('Europe/Paris');
    model.applications.api.web.commands.start.should.equal('node server.js');
  });

  it('parses composable stack.runtimes with the first runtime primary', () => {
    const model = load(fixture('flex-composable'));
    const app = model.applications.app;
    app.type.should.eql({runtime: 'php', version: '8.4'});
    app.composable.should.eql({
      channel: '26.05',
      runtimes: [
        {runtime: 'php', version: '8.4', options: {extensions: ['redis', 'xsl']}},
        {runtime: 'nodejs', version: '22', options: {}},
      ],
      packages: ['jq'],
    });
    app.runtime.extensions.should.eql(['redis', 'xsl']);
    model.warnings.should.eql([]);
  });

  it('merges filtered composable PHP extension lists in raw-first order without mutating input', () => {
    const raw = {applications: {app: {
      type: 'composable:26.05',
      runtime: {
        extensions: ['xsl', null, 42, 'redis', 'xsl'],
        disabled_extensions: ['xdebug', false, null, 'apcu', 'xdebug'],
      },
      stack: {runtimes: [{'php@8.4': {
        extensions: ['redis', null, false, 'intl', 'intl', 'xsl'],
        disabled_extensions: ['apcu', 42, null, 'opcache', 'opcache', 'xdebug'],
      }}]},
    }}};
    const original = structuredClone(raw);

    const app = normalize(raw, 'flex').applications.app;

    app.runtime.should.eql({
      extensions: ['xsl', 'redis', 'intl'],
      disabled_extensions: ['xdebug', 'apcu', 'opcache'],
    });
    app.composable.runtimes[0].options.should.eql({
      extensions: ['redis', 'intl', 'xsl'],
      disabled_extensions: ['apcu', 'opcache', 'xdebug'],
    });
    raw.should.eql(original);
  });

  it('defaults missing composable PHP extension lists to empty without mutating input', () => {
    const raw = {applications: {app: {
      type: 'composable:26.05',
      stack: {runtimes: [{'php@8.4': {}}]},
    }}};
    const original = structuredClone(raw);

    const app = normalize(raw, 'flex').applications.app;

    app.runtime.should.eql({extensions: [], disabled_extensions: []});
    app.composable.runtimes[0].options.should.eql({});
    raw.should.eql(original);
  });

  it('keeps the legacy flat composable stack and warns about ignored runtimes', () => {
    const model = load(fixture('flex-composable-legacy'));
    const app = model.applications.app;
    app.type.should.eql({runtime: 'python', version: '3.12'});
    app.composable.runtimes.should.have.length(2);
    app.composable.packages.should.eql(['curl']);
    model.warnings.should.have.length(1);
    model.warnings[0].should.include({code: 'composable-runtime-picked'});
    model.warnings[0].data.ignored.should.eql(['ruby']);
  });

  it('deep-merges Flex files alphabetically with later values winning', () => {
    const model = load(fixture('flex-merge'));
    model.applications.app.web.locations['/'].should.include({
      root: 'public', scripts: false, passthru: '/index.php',
    });
    model.services.db.configuration.should.eql({
      schemas: ['main'], endpoints: {admin: {default_schema: 'main'}},
    });
  });

  it('loads scalar and mapping includes plus archives', () => {
    const root = fixture('yaml');
    const result = new UpsunYaml(root).load(path.join(root, 'config.yaml'));
    result.included.should.eql({answer: 42});
    result.text.should.equal('hello\n');
    result.binary.should.equal(Buffer.from('hello\n').toString('base64'));
    result.archive.should.be.a('string').and.not.equal('');
  });

  it('packs !archive directories as a base64 gzipped tarball', () => {
    const root = fixture('yaml');
    const result = new UpsunYaml(root).load(path.join(root, 'config.yaml'));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-archive-'));
    try {
      const file = path.join(tmp, 'archive.tgz');
      fs.writeFileSync(file, Buffer.from(result.archive, 'base64'));
      const entries = execFileSync('tar', ['-tzf', file], {encoding: 'utf8'}).trim().split('\n');
      entries.map(entry => entry.replace(/^\.\//, '')).filter(Boolean).sort()
          .should.eql(['file.txt']);
    } finally {
      fs.rmSync(tmp, {recursive: true, force: true});
    }
  });
});
