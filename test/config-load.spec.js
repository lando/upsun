'use strict';

const path = require('path');
const chai = require('chai');
chai.should();

const {load} = require('../lib/config/index');
const UpsunYaml = require('../lib/config/yaml');

const fixture = name => path.join(__dirname, 'fixtures', name);

describe('config model loading', () => {
  it('loads the complete Flex Drupal model', () => {
    const root = fixture('flex-drupal');
    load(root).should.eql({
      flavor: 'flex',
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
            commands: {pre_start: 'php setup.php', start: null},
            upstream: {socket_family: 'unix', protocol: 'fastcgi'},
            document_root: 'web',
          },
          hooks: {build: 'composer install', deploy: 'php deploy.php', post_deploy: ''},
          crons: {queue: {spec: '*/5 * * * *', commands: {start: 'php cron.php'}}},
          workers: {},
          variables: {env: {APP_ENV: 'local'}, php: {memory_limit: '512M'}},
          dependencies: {php: {'composer/composer': '^2'}},
          runtime: {},
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
          commands: {pre_start: null, start: null},
          upstream: {socket_family: 'tcp', protocol: null}, document_root: 'web',
        },
        hooks: {build: '', deploy: '', post_deploy: ''}, crons: {}, workers: {}, variables: {env: {}},
        dependencies: {}, runtime: {}, build: {}, timezone: null,
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

  it('normalizes multi-app workers, redirects, and object relationships', () => {
    const model = load(fixture('flex-multiapp'));
    Object.keys(model.applications).should.eql(['web', 'api']);
    model.applications.web.workers.queue.commands.start.should.equal('npm run queue');
    model.applications.api.relationships.database.should.eql({service: 'db', endpoint: 'reporting'});
    model.routes['https://www.{default}/'].should.include({type: 'redirect', primary: false});
    model.routes['https://{default}/'].primary.should.equal(true);
  });

  it('selects the primary composable runtime and preserves its stack packages', () => {
    const model = load(fixture('flex-composable'));
    const app = model.applications.app;
    app.type.should.eql({runtime: 'php', version: '8.4'});
    app.composable.should.eql({
      channel: '26.05',
      runtimes: {nodejs: '22', php: '8.4'},
      packages: ['nodejs@22', {'php@8.4': {extensions: ['redis', 'xsl']}}],
    });
    model.warnings.should.have.length(1);
    model.warnings[0].code.should.equal('composable-runtime-picked');
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
});
