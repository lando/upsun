'use strict';

const {expect} = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');
const recipe = require('../builders/upsun');
const parseRecipeConfig = require('@lando/core/utils/parse-recipe-config');
const router = require('../lib/tooling-router');
const describeLinux = require('./helpers/describe-linux');
const {toLandoWarning} = require('../lib/warnings');

const fixture = name => path.join(__dirname, 'fixtures', name);

class MockRecipe {
  constructor(id, config) {
    this.id = id;
    this.config = {proxy: config.proxy, services: config.services, tooling: config.tooling};
  }
}

const confRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-builder-'));
after(() => fs.rmSync(confRoot, {recursive: true, force: true}));

const build = (root, extra = {}, landoConfig = {}) => {
  const app = {
    name: 'test',
    root,
    envFiles: extra.envFiles || [],
    project: 'testproject',
    _config: {domain: 'lndo.site', landoFile: '.lando.yml', userConfRoot: confRoot},
    _lando: {
      cache: {get: key => key === 'test.meta.cache' ? extra.meta : extra.tokens || []},
      config: {plugins: extra.plugins || [], userConfRoot: confRoot, home: confRoot},
    },
    config: {recipe: 'upsun', config: landoConfig, tooling: extra.tooling || {}},
    upsun: {branch: 'feature-x'},
  };
  const Recipe = recipe.builder(MockRecipe, recipe.config);
  const instance = new Recipe('upsun', {...parseRecipeConfig('upsun', app), _app: app, ...extra.options});
  return {instance, app};
};

describe('builders/upsun', () => {
  it('registers platformsh as an alias with identical recipe options', () => {
    const alias = require('../builders/platformsh');
    const {isEqualWith} = require('lodash');
    class CaptureRecipe {
      constructor(id, options) {
        this.options = options;
      }
    }
    const {app} = build(fixture('fixed-root'));
    const options = {...parseRecipeConfig('upsun', app), _app: app};
    const Upsun = recipe.builder(CaptureRecipe, recipe.config);
    const Platformsh = alias.builder(CaptureRecipe, alias.config);
    const upsun = new Upsun('upsun', options);
    const platformsh = new Platformsh('upsun', options);
    expect(alias.name).to.equal('platformsh');
    expect(alias.builder).to.equal(recipe.builder);
    expect(isEqualWith(platformsh.options, upsun.options, (a, b) =>
      typeof a === 'function' && typeof b === 'function' ? a.toString() === b.toString() : undefined)).to.equal(true);
  });

  it('routes mapped HTTP services and preserves varnish relationships', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-http-targets-'));
    fs.mkdirSync(path.join(root, '.upsun'));
    fs.writeFileSync(path.join(root, '.upsun', 'config.yaml'), [
      'applications:', '  app:', '    type: php:8.3', '    relationships: {cache: "varnish:http"}',
      'services:', '  varnish:', '    type: varnish:6.0', '  pdf:', '    type: gotenberg:8',
      'routes:', '  "https://{default}/": {type: upstream, upstream: "varnish:http"}',
      '  "https://pdf.{default}/": {type: upstream, upstream: "pdf:http"}',
    ].join('\n'));
    try {
      const {instance, app} = build(root);
      expect(instance.config.proxy.varnish[0]).to.include({hostname: 'test.lndo.site', port: '80'});
      expect(instance.config.proxy.pdf[0]).to.include({hostname: 'pdf.test.lndo.site', port: '3000'});
      expect(app.upsun.hostMap.varnish).to.include({host: 'varnish', scheme: 'http', port: 80});
      const relationships = JSON.parse(Buffer.from(instance.config.services.app.overrides.environment
          .PLATFORM_RELATIONSHIPS, 'base64').toString());
      expect(relationships.cache[0]).to.include({host: 'varnish', scheme: 'http', port: 80});
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('uses worker-specific relationships without changing an unmodified worker environment', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-worker-relationships-'));
    fs.mkdirSync(path.join(root, '.upsun'));
    fs.writeFileSync(path.join(root, '.upsun', 'config.yaml'), [
      'applications:', '  app:', '    type: php:8.3', '    relationships: {cache: "redis:redis"}',
      '    workers:', '      queue:', '        relationships: {extra: "redis:redis"}', '      plain: {}',
      'services:', '  redis:', '    type: redis:7',
    ].join('\n'));
    try {
      const {instance} = build(root);
      const env = name => instance.config.services[name].overrides.environment;
      const decode = name => JSON.parse(Buffer.from(env(name).PLATFORM_RELATIONSHIPS, 'base64').toString());
      expect(decode('app')).not.to.have.property('extra');
      expect(decode('app--queue').extra[0]).to.include({host: 'redis', scheme: 'redis'});
      expect(env('app--queue').EXTRA_HOST).to.equal('redis');
      expect(env('app')).not.to.have.property('EXTRA_HOST');
      expect(env('app--plain')).to.deep.equal({...env('app'), PLATFORM_APP_COMMAND: '',
        PLATFORM_PRE_APP_COMMAND: '', PLATFORM_POST_APP_COMMAND: ''});
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('rejects application names that escape the generated config directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-config-name-'));
    fs.mkdirSync(path.join(root, '.upsun'));
    try {
      for (const name of ['../evil', '.', '..']) {
        fs.writeFileSync(path.join(root, '.upsun', 'config.yaml'), `applications:\n  ${name}:\n    type: php:8.3\n`);
        expect(() => build(root)).to.throw(`Invalid Upsun service name for generated config: ${name}`);
      }
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('aggregates lifecycle warnings once per app or primary and skips replicas', () => {
    const {IMAGES} = require('../lib/mapping/upsun-registry');
    const php = Object.keys(IMAGES.php.versions).find(version => IMAGES.php.versions[version].status === 'deprecated');
    const postgres = Object.keys(IMAGES.postgresql.versions)
        .find(version => IMAGES.postgresql.versions[version].status === 'retired');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-lifecycle-'));
    fs.mkdirSync(path.join(root, '.upsun'));
    fs.writeFileSync(path.join(root, '.upsun', 'config.yaml'), [
      'applications:', '  app:', `    type: php:${php}`,
      'services:', '  db:', `    type: postgresql:${postgres}`,
      '  replica:', `    type: postgresql-replica:${postgres}`,
      '    relationships: {primary: "db:replicator"}',
    ].join('\n'));
    try {
      const lifecycle = app => app.upsun.warnings.filter(warning => warning.code.startsWith('upsun-version-'));
      const warnings = lifecycle(build(root).app);
      expect(warnings.map(warning => warning.data.name).sort()).to.eql(['app', 'db']);
      expect(warnings.find(warning => warning.data.name === 'app').code).to.equal('upsun-version-deprecated');
      expect(warnings.find(warning => warning.data.name === 'db').code).to.equal('upsun-version-retired');
      expect(lifecycle(build(fixture('flex-composable')).app)
        .filter(warning => warning.data.kind === 'application')).to.eql([]);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('initializes replicas after primaries even when declared first and wires primary-backed relationships', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-replicas-'));
    fs.mkdirSync(path.join(root, '.upsun'));
    fs.writeFileSync(path.join(root, '.upsun', 'config.yaml'), [
      'applications:', '  app:', '    type: php:8.3', '    relationships:',
      '      readonly: "replica:main"', '      database: "db:main"',
      'services:', '  replica:', '    type: mariadb-replica:11.4',
      '    relationships: {primary: "db:replicator"}',
      '    configuration: {endpoints: {main: {default_schema: main, privileges: {main: admin}}}}',
      '  db:', '    type: mariadb:11.4',
      '    configuration: {endpoints: {main: {default_schema: main, privileges: {main: admin}}}}',
    ].join('\n'));
    try {
      const {instance, app} = build(root);
      expect(instance.config.services).to.have.property('db').and.not.have.property('replica');
      expect(app.upsun.hostMap.replica).to.include({host: 'db', username: 'replica_main'});
      const inits = app.upsun.startCommands.app.filter(command => command.name.startsWith('db-init:'));
      expect(inits.map(command => command.name)).to.deep.equal(['db-init:db', 'db-init:replica']);
      expect(inits[1].cmd).to.match(/^\/helpers\/upsun-db-init.sh db mysql /);
      const sql = Buffer.from(inits[1].cmd.split(' ')[3], 'base64').toString();
      expect(sql).to.include('GRANT SELECT, SHOW VIEW, CREATE TEMPORARY TABLES ON `main`.* TO \'replica_main\'@\'%\';');
      expect(sql).not.to.include('CREATE DATABASE');
      const relationships = JSON.parse(Buffer.from(instance.config.services.app.overrides.environment
          .PLATFORM_RELATIONSHIPS, 'base64').toString());
      expect(relationships.readonly[0]).to.include({host: 'db', username: 'replica_main'});
      expect(instance.config.tooling.readonly).to.include({service: 'db'});
      expect(instance.config.tooling.pull.options.relationship.interactive.choices).to.deep.equal(['database']);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  describe('real core warm-path Landofile precedence', () => {
    let root;
    let previousCwd;
    let previousTaskCache;
    let recipeCache;
    let toolingRouter;
    let changed;

    beforeEach(() => {
      previousCwd = process.cwd();
      previousTaskCache = process.landoTaskCacheFile;
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-router-warm-'));
      fs.mkdirSync(path.join(root, '.upsun'));
      for (const dir of ['backend', 'api']) fs.mkdirSync(path.join(root, dir));
      fs.writeFileSync(path.join(root, '.upsun', 'config.yaml'), [
        'applications:', '  app:', '    type: php:8.3', '    source: {root: backend}',
        '  api:', '    type: nodejs:22', '    source: {root: api}',
      ].join('\n'));
      process.landoTaskCacheFile = path.join(root, 'tasks.cache');
      fs.writeFileSync(process.landoTaskCacheFile, JSON.stringify('{}'));
      recipeCache = path.join(root, 'recipe.cache');
      toolingRouter = path.join(root, 'tooling.router');
      const initial = build(root, {tooling: {removed: {cmd: 'old-landofile'}}}, {app: 'app'});
      fs.writeFileSync(recipeCache, JSON.stringify(initial.instance.config));
      fs.writeFileSync(toolingRouter, JSON.stringify(router.forCache(initial.app.upsun.toolingRouter)));
      changed = {
        node: {service: 'api', cmd: 'user-node', description: 'Added node command'},
        composer: {service: 'app', cmd: 'user-composer', description: 'Overridden composer command'},
      };
    });

    afterEach(() => {
      process.chdir(previousCwd);
      if (previousTaskCache === undefined) delete process.landoTaskCacheFile;
      else process.landoTaskCacheFile = previousTaskCache;
      fs.rmSync(root, {recursive: true, force: true});
    });

    for (const dir of ['', 'backend', 'api']) {
      it(`preserves changed Landofile commands at ${dir || 'the project root'}${dir === 'api' ? ' after rebuild' : ''}`,
        async () => {
          if (dir === 'api') {
            const rebuilt = build(root, {tooling: changed}, {app: 'app'});
            fs.writeFileSync(toolingRouter, JSON.stringify(router.forCache(rebuilt.app.upsun.toolingRouter)));
          }
          process.chdir(path.join(root, dir));
          const composeCache = path.join(root, 'compose.cache');
          fs.writeFileSync(composeCache, '{}');
          // Installed core utils/get-tasks.js:103-125 reads both real cache formats and merges the cwd route.
          const tasks = require('@lando/core/utils/get-tasks')({
            recipe: 'upsun', recipeCache, toolingRouter, composeCache, tooling: changed,
          }, {_: ['node']});
          for (const name of ['node', 'composer']) {
            const task = tasks.find(task => task.command === name);
            expect(task.describe).to.equal(changed[name].description);
            expect(task).to.have.property('command', name);
            const stopped = new Error('Stop before container execution');
            const result = await task.run({}, {
              cache: {get: () => ({})}, log: {debug: () => {}, silly: () => {}},
              events: {emit: (event, app) => {
                const command = app.config.tooling.find(tool => tool.name === name);
                expect(command.cmd).to.equal(changed[name].cmd);
                expect(command.service).to.equal(changed[name].service);
                return Promise.reject(stopped);
              }},
            }).catch(error => error);
            expect(result).to.equal(stopped);
          }
          expect(tasks.map(task => task.command)).not.to.include('removed');
        });
    }
  });

  for (const [layout, binary, tokenVar] of [
    ['flex-drupal', 'upsun', 'UPSUN_CLI_TOKEN'], ['fixed-root', 'platform', 'PLATFORMSH_CLI_TOKEN'],
  ]) {
    describeLinux(`manual native ${binary} commands`, () => {
      it('passes tunnel arguments unchanged through generated CLI tooling and the env wrapper', () => {
        const {spawnSync} = require('child_process');
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-manual-cli-'));
        try {
          const bin = path.join(root, 'bin');
          fs.mkdirSync(bin);
          fs.writeFileSync(path.join(bin, binary), [
            '#!/usr/bin/env node',
            'console.log(JSON.stringify({args: process.argv.slice(2),',
            `token: process.env.${tokenVar}, project: process.env.PLATFORM_PROJECT,`,
            'host: process.env.DATABASE_HOST, port: process.env.DATABASE_PORT}));',
          ].join('\n'), {mode: 0o755});
          const wrapper = path.join(root, 'upsun-exec.sh');
          fs.writeFileSync(wrapper, fs.readFileSync(path.join(__dirname, '../scripts/upsun-exec.sh'), 'utf8')
            .replace('/helpers/upsun-env.sh', path.join(__dirname, '../scripts/upsun-env.sh')));
          fs.writeFileSync(path.join(root, '.environment'), 'DATABASE_HOST=127.0.0.1\nDATABASE_PORT=31001\n');
          const {instance} = build(fixture(layout), {tokens: [{token: 'fake', email: 'fake', date: 1}]},
            {id: 'manual-project'});
          const tool = instance.config.tooling[binary];
          expect(tool.cmd).to.equal(`/helpers/upsun-exec.sh ${binary}`);
          expect(tool.options).to.equal(undefined);
          for (const args of [
            ['tunnel:open', '--environment', 'feature/x', '--app', 'app', '--port', '31001', '--', 'db:main'],
            ['tunnel:info', '--encode', '--environment=feature/x', '--app', 'app with spaces'],
          ]) {
            const env = {...process.env, ...tool.env, PLATFORM_APP_DIR: root,
              DATABASE_HOST: 'db', DATABASE_PORT: '3306', PATH: `${bin}:${process.env.PATH}`};
            for (const key of ['BASH_ENV', 'ENV', 'SHELLOPTS', 'BASHOPTS']) delete env[key];
            const result = spawnSync('bash', ['-c',
              `${tool.cmd.replace('/helpers/upsun-exec.sh', `bash "${wrapper}"`)} "$@"`, binary, ...args],
            {env, encoding: 'utf8', timeout: 10000});
            expect(result.status, result.stderr).to.equal(0);
            expect(JSON.parse(result.stdout)).to.deep.equal({args, token: 'fake', project: 'manual-project',
              host: '127.0.0.1', port: '31001'});
          }
        } finally {
          fs.rmSync(root, {recursive: true, force: true});
        }
      });
    });

    it(`builds sign-in-only auth tooling for ${layout}`, () => {
      // Given
      const saved = [{token: 'old', email: 'old@example.com', date: 1}];
      // When
      const {instance} = build(fixture(layout), {tokens: saved});
      // Then
      const task = instance.config.tooling['auth upsun'];
      expect(task).to.include({service: 'app', level: 'app'});
      expect(task.cmd).to.deep.equal([]);
      expect(task.positionals.upsun.choices).to.deep.equal(['upsun']);
      expect(task.positionals.upsun.default).to.equal('upsun');
      expect(task.options.auth.interactive.choices.map(choice => choice.value))
        .to.deep.equal(['old', 'browser', 'more']);
      expect(task.options.auth.interactive.when()).to.equal(true);
      expect(task.options['browser-login'].interactive.when).to.be.a('function');
      expect(task.options['api-token'].interactive.when({auth: 'more'})).to.equal(true);
    });

    for (const [meta, expected] of [[{token: 'new'}, 'new'], [{token: 'missing'}, 'old'], [undefined, 'old']]) {
      it(`selects ${expected} for ${binary} when the app account is ${meta?.token}`, () => {
        // Given
        const saved = [{token: 'old', email: 'old@example.com', date: 1},
          {token: 'new', email: 'new@example.com', date: 2}];
        // When
        const {instance} = build(fixture(layout), {tokens: saved, meta});
        // Then
        expect(instance.config.tooling[binary].env[tokenVar]).to.equal(expected);
      });
    }
  }

  it('omits auth tooling for Adobe Commerce Cloud', () => {
    // Given / When
    const {instance} = build(fixture('fixed-magento'));
    // Then
    expect(instance.config.tooling).not.to.have.property('auth upsun');
  });

  it('picks the first configured application when several share the Landofile root', () => {
    const {instance, app} = build(fixture('flex-shared-root'));
    expect(app.upsun.closestApp).to.equal('zebra');
    expect(Object.keys(instance.config.services)[0]).to.equal('zebra');
    expect(instance.config.tooling.node.service).to.equal('zebra');
    expect(app.upsun.toolingRouter).to.deep.equal([{route: app.root, tooling: {}}]);
  });

  it('keeps config.app selected when applications share the Landofile root', () => {
    const {instance, app} = build(fixture('flex-shared-root'), {}, {app: 'alpha'});
    expect(app.upsun.closestApp).to.equal('alpha');
    expect(instance.config.tooling.node.service).to.equal('alpha');
    expect(app.upsun.toolingRouter).to.deep.equal([{route: app.root, tooling: {}}]);
  });

  it('wires database tooling to the closest app\'s database', () => {
    const {instance} = build(fixture('flex-drupal'));
    for (const [key, script] of [['db-import <file>', 'sql-import'], ['db-export [file]', 'sql-export']]) {
      expect(instance.config.tooling[key]).to.include({service: ':host', cmd: `/helpers/${script}.sh`});
      expect(instance.config.tooling[key].options.host.default).to.equal('db');
    }
  });

  it('leaves an unsupported closest runtime out of services instead of adding it as undefined', () => {
    const {instance, app} = build(fixture('flex-unsupported'));
    expect(instance.config.services).to.not.have.property('app');
    expect(Object.values(instance.config.services)).to.not.include(undefined);
    expect(app.upsun.warnings.map(warning => warning.code)).to.include('runtime-unsupported');
  });

  it('replaces pull, push and switch with unsupported messages for magento projects', () => {
    const {spawnSync} = require('child_process');
    const {instance} = build(fixture('fixed-magento'));
    for (const cmd of ['pull', 'push', 'switch']) {
      const tool = instance.config.tooling[cmd];
      expect(tool.description).to.include('not available for Adobe Commerce Cloud');
      const env = {...process.env};
      for (const key of ['BASH_ENV', 'ENV', 'SHELLOPTS', 'BASHOPTS']) delete env[key];
      const result = spawnSync('sh', ['-c', tool.cmd], {encoding: 'utf8', env, timeout: 10000});
      expect(result.status).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr.trim()).to.equal(
        `lando ${cmd} is not available for Adobe Commerce Cloud projects; use the magento-cloud CLI.`);
    }
  });

  it('passes config.domains to routes and proxy', () => {
    const {instance} = build(fixture('flex-envfile'), {}, {domains: ['Example.COM']});
    expect(instance.config.proxy.app.map(entry => entry.hostname)).to.include('example-com.test.lndo.site');
    const env = instance.config.services.app.overrides.environment;
    expect(JSON.parse(Buffer.from(env.PLATFORM_ROUTES, 'base64').toString()))
      .to.have.property('https://example-com.test.lndo.site/');
    for (const domains of ['example.com', [42], null]) {
      expect(() => build(fixture('flex-envfile'), {}, {domains}))
        .to.throw('config.domains must be an array of strings');
    }
  });

  it('reads env_file keys from the Lando app and drops them from promoted variables', () => {
    const root = fixture('flex-envfile');
    const {instance} = build(root, {envFiles: [path.join(root, '.env'), path.join(root, 'missing')]});
    const env = instance.config.services.app.overrides.environment;
    expect(env).not.to.have.property('FOO');
    expect(env).to.include({BAR: 'from-app', PLATFORM_VENDOR: 'upsun'});
  });

  it('sets UPSUN_PROVISION_WAIT on non-PHP apps with database init', () => {
    const {instance, app} = build(fixture('flex-full'), {}, {app: 'api', crons: true});
    expect(app.upsun.startCommands.api.some(command => command.name.startsWith('db-init:'))).to.equal(true);
    expect(instance.config.services.api.overrides.environment.UPSUN_PROVISION_WAIT).to.equal('300');
    for (const [name, service] of Object.entries(instance.config.services)) {
      if (name !== 'api') expect(service.overrides?.environment || {}).not.to.have.property('UPSUN_PROVISION_WAIT');
    }
    for (const [root, config] of [['flex-drupal', {}], ['flex-static', {}]]) {
      for (const service of Object.values(build(fixture(root), {}, config).instance.config.services)) {
        expect(service.overrides?.environment || {}).not.to.have.property('UPSUN_PROVISION_WAIT');
      }
    }
  });

  it('adds application targets to the hostMap before generating env', () => {
    const {instance, app} = build(fixture('flex-app-rel'), {}, {app: 'api'});
    expect(app.upsun.hostMap.app).to.deep.equal({host: 'app_nginx', port: 80, scheme: 'http'});
    expect(app.upsun.hostMap.api).to.deep.equal({host: 'api', port: 8888, scheme: 'http'});
    const env = instance.config.services.api.overrides.environment;
    expect(env).to.include({BACKEND_HOST: 'app_nginx', BACKEND_PORT: '80', BACKEND_URL: 'http://app_nginx:80'});
    const payload = JSON.parse(Buffer.from(env.PLATFORM_RELATIONSHIPS, 'base64').toString());
    expect(payload.backend[0]).to.include({type: 'php:8.3', path: null});
    expect(app.upsun.warnings.filter(warning => warning.code === 'relationship-unknown-service'))
      .to.have.lengthOf(1);
  });

  it('warns relationship-unresolved and still builds', () => {
    const {instance, app} = build(fixture('flex-app-rel'));
    expect(app.upsun.warnings.filter(warning => warning.code === 'relationship-unresolved')).to.deep.equal([{
      code: 'relationship-unresolved',
      message: 'Relationship ghost of app points at nothere, which has no local service; it was skipped.',
    }]);
    expect(instance.config.services.app.overrides.environment).not.to.have.property('GHOST_HOST');
  });

  it('translates a Flex project into lando services, proxy and tooling', () => {
    const {instance, app} = build(fixture('flex-drupal'), {}, {id: 'abc123'});
    const {services, proxy, tooling} = instance.config;

    expect(Object.keys(services)).to.include.members(['app', 'db', 'redis', 'mailpit']);
    expect(Object.keys(services)[0]).to.equal('app');
    expect(services.app).to.include({via: 'nginx', webroot: 'web'});
    expect(services.app.type).to.match(/^php:8\./);
    // Rendered files are written under the Lando config dir so `$` never reaches compose interpolation
    expect(services.app.config.vhosts).to.match(/[\\/]config[\\/]upsun[\\/][^\\/]+[\\/]app-vhost\.conf$/);
    expect(fs.readFileSync(services.app.config.vhosts, 'utf8')).to.include('fastcgi_pass app:9000;');
    expect(fs.readFileSync(services.app.config.php, 'utf8')).to.include('memory_limit = 512M');
    expect(services.db.creds).to.deep.equal({user: 'upsun', password: 'upsun', database: 'main'});

    const env = services.app.overrides.environment;
    expect(env).to.include({
      PLATFORM_APPLICATION_NAME: 'app',
      PLATFORM_PROJECT: 'abc123',
      PLATFORM_BRANCH: 'feature-x',
      PLATFORM_VENDOR: 'upsun',
      PLATFORM_SMTP_HOST: 'mailpit',
      PLATFORM_PRE_APP_COMMAND: 'php setup.php',
      DATABASE_HOST: 'db',
      REDIS_HOST: 'redis',
    });
    expect(env.DATABASE_URL).to.equal('mysql://upsun:upsun@db:3306/main');
    expect(services.app.build_as_root_internal[0]).to.equal(
      'apt-get -o Acquire::Retries=3 update && apt-get -o Acquire::Retries=3 install -y jq');
    expect(services.app.build_as_root_internal.at(-1)).to.equal('/helpers/upsun-install-cli.sh upsun');
    expect(services.app.build_internal).to.include('/helpers/upsun-hook.sh build');
    expect(services.app).to.not.have.property('run_internal');
    expect(services.app).to.not.have.any.keys('build', 'build_as_root', 'upsun');

    expect(services.mailpit).to.include({type: 'mailpit', port: 25});
    expect(services.mailpit.mailFrom).to.deep.equal(['app']);
    expect(proxy.app_nginx[0]).to.include({hostname: 'test.lndo.site', port: '80'});
    expect(proxy.mailpit[0].hostname).to.equal('mail.test.lndo.site');

    expect(tooling).to.include.all.keys(
        'php', 'composer', 'database', 'redis', 'cron <name>', 'xdebug-on', 'xdebug-off', 'upsun', 'pull', 'push',
        'auth upsun');
    expect(tooling.drush.cmd).to.equal('/helpers/upsun-exec.sh /app/vendor/bin/drush');
    expect(tooling.upsun.env.UPSUN_CLI_NO_INTERACTION).to.equal('1');
    expect(app.upsun.startCommands.app.map(command => command.name))
        .to.deep.equal(['mounts', 'db-init:db', 'provisioned', 'pre_start', 'deploy']);
    expect(app.upsun).to.include({
      flavor: 'flex',
      closestApp: 'app',
      closestType: 'php',
      projectId: 'abc123',
      mail: true,
    });
  });

  it('wires workers, cron sidecars, operations, proxy targets and extra hosts', () => {
    const {instance, app} = build(fixture('flex-full'), {}, {crons: true, app: 'app'});
    const {services, proxy, tooling} = instance.config;

    expect(Object.keys(services)).to.include.members([
      'app', 'app--queue', 'app--cron', 'api', 'db', 'redis', 'mailpit',
    ]);
    expect(services['app--queue'].overrides.environment).to.include({
      PLATFORM_APP_COMMAND: 'php worker.php',
      PLATFORM_APPLICATION_NAME: 'app',
    });
    expect(services['app--cron'].command).to.equal('/helpers/upsun-crond.sh');
    expect(services['app--cron'].build_as_root_internal.at(-1))
        .to.equal('/helpers/upsun-install-supercronic.sh');
    expect(services['app--cron'].build_as_root_internal).to.not.include('/helpers/upsun-install-cli.sh upsun');
    expect(services.app.overrides.extra_hosts).to.deep.equal(['example.internal:127.0.0.1']);
    expect(services.app.overrides.environment.TZ).to.equal('Europe/Paris');
    expect(services.mailpit.mailFrom).to.deep.equal(['app', 'app--queue', 'app--cron', 'api']);
    expect(proxy.api[0]).to.include({hostname: 'api.test.lndo.site', port: '8888'});
    expect(app.upsun.startCommands).to.not.have.property('app--queue');
    expect(tooling).to.have.property('operation <name>');
    expect(app.upsun.warnings.map(warning => warning.code)).to.include('php-extension-unsupported');
  });

  it('uses installed plugin version tables when present', () => {
    const plugins = [{name: '@lando/php', dir: fixture('plugins/@lando/php')}];
    const installed = build(fixture('flex-drupal'), {plugins});
    const fallback = build(fixture('flex-drupal'));

    expect(installed.instance.config.services.app.type).to.equal('php:8.3');
    expect(installed.app.upsun.warnings.map(warning => warning.code)).to.include('version-fallback');
    expect(fallback.instance.config.services.app.type).to.equal('php:8.4');
  });

  it('derives the project id from the local project file', () => {
    const derived = build(fixture('flex-local-project'));
    const explicit = build(fixture('flex-local-project'), {}, {id: 'explicit'});

    expect(derived.instance.config.services.app.overrides.environment.PLATFORM_PROJECT)
        .to.equal('abcdefg123456');
    expect(derived.app.upsun.projectId).to.equal('abcdefg123456');
    expect(explicit.instance.config.services.app.overrides.environment.PLATFORM_PROJECT).to.equal('explicit');
    expect(explicit.app.upsun.projectId).to.equal('explicit');
  });

  it('honours config.mail false and an existing mailpit service', () => {
    const {instance, app} = build(fixture('flex-drupal'), {}, {mail: false});
    const {services, proxy} = instance.config;

    expect(services).to.not.have.property('mailpit');
    expect(proxy).to.not.have.property('mailpit');
    expect(services.app.overrides.environment.PLATFORM_SMTP_HOST).to.equal('');
    expect(services.app.build_as_root_internal.join('\n')).to.not.include('zzzz-upsun-mail.ini');
    expect(app.upsun.mail).to.equal(false);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-builder-'));
    try {
      fs.mkdirSync(path.join(root, '.upsun'));
      fs.writeFileSync(path.join(root, '.upsun', 'config.yaml'), [
        'applications:', '  app:', '    type: php:8.3',
        'services:', '  mailpit:', '    type: mailpit:1',
      ].join('\n'));
      const existing = build(root);
      expect(existing.instance.config.services).to.not.have.property('mailpit');
      expect(existing.app.upsun.mail).to.equal(false);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('adds the nginx sidecar target for non-PHP apps with locations', () => {
    const {instance} = build(fixture('flex-static'), {}, {
      overrides: {site: {web: {locations: {'/': {passthru: '/index.html'}}}}},
    });
    const {services, proxy} = instance.config;

    expect(services.site.command).to.equal('/helpers/upsun-start.sh');
    expect(services.site_nginx.type).to.equal('nginx');
    expect(services.site_nginx).to.not.have.property('overrides');
    expect(services.site_nginx).to.not.have.any.keys('build_internal', 'build_as_root_internal');
    expect(proxy.site_nginx[0]).to.include({hostname: 'test.lndo.site', port: '80'});
    const vhost = fs.readFileSync(services.site_nginx.config.vhosts, 'utf8');
    expect(vhost).to.include('try_files $uri $uri/ /index.html$is_args$args;');
    expect(vhost).not.to.include('proxy_pass');
    expect(vhost).not.to.include('fastcgi_pass');
  });

  require('./helpers/describe-linux')('worker command isolation through the start wrapper', () => {
    for (const start of ['echo WORKER_STARTED', null]) {
      it(`never runs web commands for a worker with ${start ? 'its own start' : 'no start'}`, () => {
        const {spawnSync} = require('child_process');
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-worker-commands-'));
        try {
          fs.mkdirSync(path.join(root, '.upsun'));
          fs.mkdirSync(path.join(root, 'bin'));
          fs.writeFileSync(path.join(root, 'bin', 'tail'), '#!/bin/bash\necho WORKER_IDLE\n', {mode: 0o755});
          fs.writeFileSync(path.join(root, '.upsun', 'config.yaml'), JSON.stringify({applications: {app: {
            type: 'nodejs:22', web: {commands: {pre_start: 'echo WEB_PRE_START', start: 'echo WEB_STARTED',
              post_start: 'echo WEB_POST_START'}}, workers: {queue: {commands: {start}}},
          }}}));
          const {instance} = build(root);
          const env = instance.config.services['app--queue'].overrides.environment;
          const child = {...process.env, ...env, PLATFORM_APP_DIR: root, UPSUN_PROVISION_WAIT: '0',
            UPSUN_CLI_CONTEXT: '',
            UPSUN_ENV_HELPER: path.join(__dirname, '../scripts/upsun-env.sh'),
            UPSUN_LOG_HELPER: fixture('log.sh'), PATH: `${path.join(root, 'bin')}:${process.env.PATH}`};
          for (const key of ['BASH_ENV', 'ENV', 'SHELLOPTS', 'BASHOPTS']) delete child[key];
          const result = spawnSync('bash', [path.join(__dirname, '../scripts/upsun-start.sh')],
            {env: child, timeout: 10000, encoding: 'utf8'});
          expect(result.status, result.stderr).to.equal(0);
          expect(result.stdout).to.equal(start ? 'WORKER_STARTED\n' : 'WORKER_IDLE\n');
          expect(env).to.include({PLATFORM_PRE_APP_COMMAND: '', PLATFORM_POST_APP_COMMAND: '',
            PLATFORM_APP_COMMAND: start || ''});
          expect(instance.config.services.app.overrides.environment).to.include({
            PLATFORM_PRE_APP_COMMAND: 'echo WEB_PRE_START', PLATFORM_APP_COMMAND: 'echo WEB_STARTED',
            PLATFORM_POST_APP_COMMAND: 'echo WEB_POST_START'});
        } finally {
          fs.rmSync(root, {recursive: true, force: true});
        }
      });
    }
  });

  it('translates a Fixed project using the platform CLI', () => {
    const {instance, app} = build(fixture('fixed-root'));
    const {services, tooling} = instance.config;
    expect(app.upsun.flavor).to.equal('fixed');
    expect(tooling.platform.cmd).to.equal('/helpers/upsun-exec.sh platform');
    expect(tooling.pull.env.UPSUN_CLI_TOKEN_VAR).to.equal('PLATFORMSH_CLI_TOKEN');
    const appService = Object.values(services).find(service => String(service.type).startsWith('php:'));
    expect(appService.overrides.environment.PLATFORM_VENDOR).to.equal('platformsh');
    expect(appService.overrides.environment.PLATFORM_PROJECT).to.equal('lando');
  });

  it('honours config.app, recipe options.services and extra build/run steps', () => {
    const applications = require('../lib/config/index').load(fixture('flex-multiapp')).applications;
    const selected = Object.keys(applications)[1];
    const {instance} = build(fixture('flex-multiapp'), {
      options: {build: ['echo user-build'], run: ['echo user-run'], services: {db: {portforward: 3307}}},
    }, {app: selected});
    const {services} = instance.config;
    const closest = Object.entries(services).find(([, service]) =>
      (service.build_internal || []).includes('echo user-build'));

    expect(closest).to.not.equal(undefined);
    expect(closest[1].run_internal).to.deep.equal(['echo user-run']);
    expect(services.db.portforward).to.equal(3307);
  });

  it('follows runtime.xdebug.idekey unless the Landofile sets config.xdebug', () => {
    const root = fixture('flex-drupal');
    const overrides = {app: {runtime: {xdebug: {idekey: 'PHPSTORM'}}}};
    expect(build(root).instance.config.services.app.xdebug).to.equal(false);
    const keyed = build(root, {}, {overrides}).instance.config.services.app;
    expect(keyed.xdebug).to.equal('debug');
    expect(fs.readFileSync(keyed.config.php, 'utf8')).to.include('xdebug.idekey = PHPSTORM');
    expect(build(root, {}, {overrides, xdebug: false}).instance.config.services.app.xdebug).to.equal(false);
    expect(build(root, {}, {xdebug: true}).instance.config.services.app.xdebug).to.equal('debug');
    expect(keyed.overrides.environment.XDEBUG_MODE).to.equal('');
  });

  it('applies raw config overrides before normalization and does not treat them as service merges', () => {
    const root = fixture('flex-drupal');
    const {instance} = build(root, {}, {
      variables: {app: {env: {FROM_LANDO: '1'}}},
      overrides: {
        app: {variables: {env: {APP_ENV: 'staged'}, php: {memory_limit: '128M'}}},
        db: {configuration: {schemas: ['custom']}},
      },
    });
    const env = instance.config.services.app.overrides.environment;
    expect(env.FROM_LANDO).to.equal('1');
    expect(env.APP_ENV).to.equal('staged');
    expect(fs.readFileSync(instance.config.services.app.config.php, 'utf8')).to.include('memory_limit = 128M');
    expect(instance.config.services.db.creds.database).to.equal('custom');
  });

  it('preserves user relationship configuration and manual service connection overrides', () => {
    const relationships = {database: [{host: '127.0.0.1', port: 31001, username: 'remote',
      password: 'manual secret', path: 'remote_db', scheme: 'mysql'}]};
    const encoded = Buffer.from(JSON.stringify(relationships)).toString('base64');
    const environment = {PLATFORM_RELATIONSHIPS: encoded, DATABASE_HOST: '127.0.0.1', DATABASE_PORT: '31001',
      DATABASE_USERNAME: 'remote', DATABASE_PASSWORD: 'manual secret', DATABASE_PATH: 'remote_db'};
    const {instance, app} = build(fixture('flex-drupal'), {options: {
      services: {app: {overrides: {environment, env_file: ['manual-connections.env']}}},
      tooling: {upsun: {env: {PLATFORM_ENVIRONMENT: 'manual-environment'}},
        connections: {service: 'app', cmd: '/helpers/upsun-exec.sh upsun tunnel:info --encode'}},
    }}, {overrides: {app: {relationships: {analytics: 'db:mysql'}}}});
    const service = instance.config.services.app;
    expect(service.overrides.environment).to.include(environment);
    expect(JSON.parse(Buffer.from(service.overrides.environment.PLATFORM_RELATIONSHIPS, 'base64').toString()))
      .to.deep.equal(relationships);
    expect(service.overrides.env_file).to.deep.equal(['manual-connections.env']);
    expect(app.upsun.model.applications.app.relationships.analytics).to.deep.equal({service: 'db', endpoint: 'mysql'});
    expect(instance.config.tooling.analytics.service).to.equal('db');
    expect(instance.config.tooling.upsun.cmd).to.equal('/helpers/upsun-exec.sh upsun');
    expect(instance.config.tooling.upsun.env.PLATFORM_ENVIRONMENT).to.equal('manual-environment');
    expect(instance.config.tooling.connections.cmd).to.equal('/helpers/upsun-exec.sh upsun tunnel:info --encode');
    expect(instance.config.services).to.have.keys('app', 'db', 'redis', 'mailpit');
  });

  it('reuses a cached app account for sync tooling and keeps auth upsun interactive', () => {
    const saved = [
      {token: 'old', email: 'old@example.com', date: 1},
      {token: 'new', email: 'new@example.com', date: 2},
    ];
    const reused = build(fixture('flex-drupal'), {tokens: saved, meta: {token: 'new', email: 'new@example.com'}});
    expect(reused.instance.config.tooling.pull.options.auth.default).to.equal('new');
    expect(reused.instance.config.tooling.pull.env).not.to.have.property('UPSUN_CLI_TOKEN');
    expect(reused.instance.config.tooling.pull.options.auth).to.not.have.property('interactive');
    expect(reused.instance.config.tooling['auth upsun'].options.auth.interactive.when()).to.equal(true);
    const stale = build(fixture('flex-drupal'), {tokens: saved, meta: {token: 'gone', email: 'gone@example.com'}});
    expect(stale.instance.config.tooling.pull.options.auth.interactive.when()).to.equal(true);
    expect(stale.instance.config.tooling.pull.env).not.to.have.property('UPSUN_CLI_TOKEN');
  });

  it('routes per-app tooling, pins the root fallback, and leaves Landofile commands alone', () => {
    const root = fixture('flex-multiapp');
    const pinned = build(root, {}, {app: 'api'});
    const byRoute = Object.fromEntries(pinned.app.upsun.toolingRouter.map(entry =>
      [path.relative(root, entry.route), entry.tooling]));
    expect(byRoute['']).to.deep.equal({});
    expect(byRoute.frontend.node.cmd).to.include('node');
    expect(byRoute.frontend.python).to.equal(false);
    expect(byRoute.api).to.deep.equal({});
    expect(Object.entries(byRoute.frontend).filter(([, value]) => value === false).map(([name]) => name))
      .to.satisfy(names => names.every(name => Object.hasOwn(pinned.instance.config.tooling, name)));
    expect(pinned.instance.config.tooling['switch [environment]'].positionals.environment)
      .to.include({type: 'string'});
    const custom = build(root, {tooling: {node: {service: 'web', cmd: 'custom'}}});
    for (const entry of custom.app.upsun.toolingRouter) expect(entry.tooling).to.not.have.property('node');
    expect(custom.instance.config.tooling.node.cmd).to.equal('/helpers/upsun-exec.sh node');
    expect(custom.app.config.tooling.node.cmd).to.equal('custom');
  });

  it('keeps single-app routes empty and Landofile tooling out of the recipe cache', () => {
    const {instance, app} = build(fixture('flex-drupal'), {
      tooling: {composer: {cmd: 'custom'}, custom: {cmd: 'landofile'}},
      options: {tooling: {php: {cmd: 'recipe-option'}}},
    });
    expect(app.upsun.toolingRouter.every(entry => Object.keys(entry.tooling).length === 0)).to.equal(true);
    expect(instance.config.tooling.composer.cmd).not.to.equal('custom');
    expect(instance.config.tooling).not.to.have.property('custom');
    expect(instance.config.tooling.php.cmd).to.equal('recipe-option');
  });

  it('drops another app route that shares the closest app source path', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-router-paths-'));
    try {
      fs.mkdirSync(path.join(root, '.upsun'));
      fs.writeFileSync(path.join(root, '.upsun', 'config.yaml'), [
        'applications:', '  other:', '    type: nodejs:22', '    source: {root: backend}',
        '  app:', '    type: php:8.3', '    source: {root: backend}',
        '  worker:', '    type: python:3.13', '    source: {root: worker}',
        '  frontend:', '    type: nodejs:22', '    source: {root: frontend}',
      ].join('\n'));
      const {app} = build(root, {}, {app: 'app'});
      expect(app.upsun.toolingRouter.slice(0, 2)).to.deep.equal([
        {route: root, tooling: {}}, {route: path.join(root, 'backend'), tooling: {}},
      ]);
      expect(router.selectRoute(app.upsun.toolingRouter, path.join(root, 'backend')).tooling).to.deep.equal({});
      expect(app.upsun.toolingRouter.filter(entry => entry.route === path.join(root, 'backend'))).to.have.length(1);
      const frontend = router.selectRoute(app.upsun.toolingRouter, path.join(root, 'frontend')).tooling;
      expect(frontend.php).to.equal(false);
      expect(frontend).not.to.have.property('python');
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('rejects unknown config.app names', () => {
    expect(() => build(fixture('flex-drupal'), {}, {app: 'nope'})).to.throw(/config\.app "nope"/);
  });

  it('gives friendly errors for missing or mixed config', () => {
    expect(() => build(fixture('no-config'))).to.throw(/No Upsun configuration found/);
    expect(() => build(fixture('mixed-config'))).to.throw(/Both \.upsun\/ and \.platform\//);
    expect(() => build(fixture('mixed-magento'))).to.throw(/Adobe Commerce \.magento/);
    expect(() => build(fixture('no-apps'))).to.throw(/No applications defined/);
  });

  it('uses a specific title for unavailable PHP extensions', () => {
    expect(toLandoWarning({
      code: 'php-extension-unsupported',
      message: 'unsupported',
    }).title).to.equal('PHP extension not available locally');
  });
});
