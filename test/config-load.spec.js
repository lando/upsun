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
  for (const flavor of ['flex', 'fixed']) {
    describe(`${flavor} local overrides`, () => {
      let root;
      let files;

      beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-overrides-'));
        const app = {
          name: 'app', type: 'php:8.3',
          variables: {env: {KEEP: 'original', WINNER: 'original'}, php: {memory_limit: '128M'}},
          runtime: {extensions: ['redis', 'xsl']},
          hooks: {build: 'echo build', deploy: 'echo deploy'},
          web: {locations: {'/': {root: 'web', passthru: true}}},
          relationships: {database: {service: 'db'}},
        };
        const services = {db: {
          type: 'mariadb:10.6', configuration: {schemas: ['main', 'reporting']},
        }};
        const applications = {app, other: {name: 'other', type: 'nodejs:22'}};
        const routes = {'https://{default}/': {type: 'upstream', upstream: 'app:http'}};
        files = flavor === 'flex' ? {
          '.upsun/config.yaml': {applications, services, routes},
        } : {
          '.platform/applications.yaml': Object.values(applications),
          '.platform/services.yaml': services,
          '.platform/routes.yaml': routes,
        };
        fs.mkdirSync(path.join(root, flavor === 'flex' ? '.upsun' : '.platform'));
        for (const [file, data] of Object.entries(files)) {
          fs.writeFileSync(path.join(root, file), JSON.stringify(data));
        }
      });

      afterEach(() => fs.rmSync(root, {recursive: true, force: true}));

      it('preserves no-options behavior with empty options', () => {
        const baseline = load(root);
        load(root, {}).should.eql(baseline);
        load(root, {overrides: {}, variables: {}}).should.eql(baseline);
        baseline.applications.other.raw.should.not.have.property('variables');
      });

      it('merges legacy variables first and lets application overrides win', () => {
        const model = load(root, {
          variables: {app: {env: {WINNER: 'legacy', LEGACY: 'kept'}, php: {memory_limit: '256M'}}},
          overrides: {app: {variables: {env: {WINNER: 'override', LOCAL: 'added'}}}},
        });
        model.applications.app.variables.should.eql({
          env: {KEEP: 'original', WINNER: 'override', LEGACY: 'kept', LOCAL: 'added'},
          php: {memory_limit: '256M'},
        });
        model.applications.app.raw.variables.should.eql(model.applications.app.variables);
      });

      it('supports legacy variables without overrides', () => {
        load(root, {variables: {app: {env: {WINNER: 'legacy'}}}})
          .applications.app.variables.env.should.eql({KEEP: 'original', WINNER: 'legacy'});
      });

      it('applies app and service overrides before normalization and relationship inference', () => {
        const model = load(root, {overrides: {
          app: {
            type: 'php:8.4', source: {root: 'local'},
            hooks: {deploy: 'echo local'},
            web: {locations: {'/': {root: 'public', passthru: false}}},
            relationships: {cache: {service: 'db'}},
            workers: {queue: {commands: {start: 'php queue.php'}, relationships: {database: {service: 'db'}}}},
          },
          db: {type: 'postgresql:16', configuration: {databases: ['local']}},
        }});
        const app = model.applications.app;
        app.type.should.eql({runtime: 'php', version: '8.4'});
        app.sourceRoot.should.equal('local');
        app.hooks.should.eql({build: 'echo build', deploy: 'echo local', post_deploy: ''});
        app.web.document_root.should.equal('public');
        chai.expect(app.web.locations['/'].passthru).to.equal(null);
        app.relationships.should.eql({
          database: {service: 'db', endpoint: 'postgresql'},
          cache: {service: 'db', endpoint: 'postgresql'},
        });
        app.workers.queue.relationships.database.should.eql({service: 'db', endpoint: 'postgresql'});
        app.raw.type.should.equal('php:8.4');
        model.services.db.type.should.eql({service: 'postgresql', version: '16'});
        model.services.db.configuration.should.eql({schemas: ['main', 'reporting'], databases: ['local']});
        model.services.db.raw.type.should.equal('postgresql:16');
        model.warnings.should.eql([]);
      });

      it('deep-merges arrays by index rather than replacing or concatenating them', () => {
        const model = load(root, {
          variables: {app: {env: {LIST: [{legacy: true, winner: 'legacy'}, 'tail']}}},
          overrides: {
            app: {runtime: {extensions: ['intl']}, variables: {env: {LIST: [{winner: 'override'}]}}},
            db: {configuration: {schemas: ['local']}},
          },
        });
        model.applications.app.runtime.extensions.should.eql(['intl', 'xsl']);
        model.applications.app.variables.env.LIST.should.eql([{legacy: true, winner: 'override'}, 'tail']);
        model.services.db.configuration.schemas.should.eql(['local', 'reporting']);
      });

      it('ignores unknown targets and does not apply legacy variables to services', () => {
        const baseline = load(root);
        const model = load(root, {
          variables: {missing: {env: {FOO: 'bar'}}, db: {env: {FOO: 'bar'}}},
          overrides: {'missing': {type: 'redis:7.2'}, 'https://{default}/': {upstream: 'missing:http'}},
        });
        model.should.eql(baseline);
      });

      it('does not mutate options or source files and isolates repeated loads', () => {
        const baseline = load(root);
        const options = {
          variables: {app: {env: {LIST: ['legacy', 'tail']}}},
          overrides: {
            app: {variables: {env: {LOCAL: {nested: 'original'}}}},
            db: {configuration: {schemas: ['local']}},
          },
        };
        const original = structuredClone(options);
        const first = load(root, options);
        const expected = structuredClone(first);
        first.applications.app.variables.env.LIST.push('mutated');
        first.applications.app.raw.variables.env.LOCAL.nested = 'mutated';
        first.services.db.configuration.schemas.push('mutated');
        options.should.eql(original);
        load(root, options).should.eql(expected);
        load(root).should.eql(baseline);
        for (const [file, data] of Object.entries(files)) {
          fs.readFileSync(path.join(root, file), 'utf8').should.equal(JSON.stringify(data));
        }
      });
    });
  }

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
          runtime: {extensions: [], disabled_extensions: [], xdebug: {idekey: null}},
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
          cache: {}, attributes: {}, ssi: {enabled: false}, redirects: {}, tls: {}, http_access: {},
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
        runtime: {extensions: [], disabled_extensions: [], xdebug: {idekey: null}}, build: {}, timezone: null,
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
        cache: {}, attributes: {}, ssi: {enabled: false}, redirects: {}, tls: {}, http_access: {},
        raw: {type: 'upstream', upstream: 'app:http'},
      }},
      warnings: [],
    });
  });

  it('loads map-form Fixed applications with names, types and source roots', () => {
    const apps = load(fixture('fixed-applications-map')).applications;
    Object.keys(apps).should.eql(['web', 'api']);
    apps.web.should.include({name: 'web', sourceRoot: 'web'});
    apps.api.should.include({name: 'api', sourceRoot: 'api'});
    apps.web.type.should.eql({runtime: 'nodejs', version: '22'});
    apps.api.type.should.eql({runtime: 'php', version: '8.2'});
  });

  it('validates application names in list and map forms for both Fixed layouts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-names-'));
    try {
      for (const dir of ['.platform', '.magento']) {
        fs.mkdirSync(path.join(root, dir));
        const file = path.join(root, dir, 'applications.yaml');
        const fixed = require('../lib/config/fixed');
        const read = () => fixed.load(root, [file], {dir, appFile: `${dir}.app.yaml`});
        fs.writeFileSync(file, 'api: {name: api, type: "php:8.2"}\n');
        read().applications.api.name.should.equal('api');
        fs.writeFileSync(file, 'api: {name: other, type: "php:8.2"}\n');
        read.should.throw(`Application name "other" does not match key "api" in ${file}`);
        fs.writeFileSync(file, '- type: php:8.2\n');
        read.should.throw(`Application without a resolvable name in ${file}`);
      }
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('selects the first upstream unless a route explicitly declares primary', () => {
    const routes = {
      'https://www.example.test/': {type: 'redirect', to: 'https://example.test/'},
      'https://example.test/': {type: 'upstream', upstream: 'api:http'},
      'https://{default}/': {type: 'upstream', upstream: 'web:http'},
    };
    const normalized = () => normalize({routes}, 'flex').routes;
    normalized()['https://example.test/'].primary.should.equal(true);
    normalized()['https://{default}/'].primary.should.equal(false);
    routes['https://{default}/'].primary = true;
    normalized()['https://{default}/'].primary.should.equal(true);
    normalized()['https://example.test/'].primary.should.equal(false);
  });

  it('detects circular YAML includes and clears the loading chain after failure', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-circular-'));
    try {
      const file = path.join(root, 'a.yaml');
      fs.writeFileSync(file, 'next: !include b.yaml\n');
      fs.writeFileSync(path.join(root, 'b.yaml'), 'next: !include {path: a.yaml}\n');
      const loader = new UpsunYaml(root);
      (() => loader.load(file)).should.throw('Circular YAML include: a.yaml -> b.yaml -> a.yaml');
      fs.writeFileSync(path.join(root, 'b.yaml'), 'answer: 42\n');
      loader.load(file).should.eql({next: {answer: 42}});
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
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
    app.runtime.should.eql({extensions: ['xsl', 'blackfire'], disabled_extensions: [], xdebug: {idekey: null}});
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

  it('normalizes runtime.xdebug.idekey to a string or null', () => {
    const keyed = normalize({applications: {app: {type: 'php:8.4', runtime: {xdebug: {idekey: 'PHPSTORM'}}}}}, 'flex');
    keyed.applications.app.runtime.xdebug.should.eql({idekey: 'PHPSTORM'});
    const invalid = normalize({applications: {app: {type: 'php:8.4', runtime: {xdebug: {idekey: 42}}}}}, 'flex');
    invalid.applications.app.runtime.xdebug.should.eql({idekey: null});
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
      xdebug: {idekey: null},
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

    app.runtime.should.eql({extensions: [], disabled_extensions: [], xdebug: {idekey: null}});
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

  it('rejects include and archive paths outside the project, including symlinks and absolute paths', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-yaml-bounds-'));
    const root = path.join(tmp, 'project');
    fs.mkdirSync(path.join(root, '.upsun'), {recursive: true});
    fs.writeFileSync(path.join(tmp, 'outside.txt'), 'secret');
    fs.symlinkSync(path.join(tmp, 'outside.txt'), path.join(root, '.upsun', 'link.txt'));
    const file = path.join(root, '.upsun', 'config.yaml');
    try {
      for (const tag of ['!include', '!archive', '!include {type: string, path:']) {
        for (const target of ['../../outside.txt', 'link.txt', path.join(tmp, 'outside.txt')]) {
          const value = tag.includes('{') ? `${tag} ${target}}` : `${tag} ${target}`;
          fs.writeFileSync(file, `applications: ${value}\n`);
          (() => load(root)).should.throw(`YAML path escapes project root: ${target}`);
        }
      }
      fs.writeFileSync(path.join(root, 'apps.yaml'), 'app: {type: "php:8.3"}\n');
      fs.writeFileSync(file, 'applications: !include ../apps.yaml\n');
      load(root).applications.should.have.property('app');
    } finally {
      fs.rmSync(tmp, {recursive: true, force: true});
    }
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
