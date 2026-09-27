'use strict';

const {expect} = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');
const recipe = require('../builders/upsun');
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
      cache: {get: () => extra.tokens || []},
      config: {plugins: extra.plugins || [], userConfRoot: confRoot},
    },
    config: {recipe: 'upsun', config: landoConfig},
    upsun: {branch: 'feature-x'},
  };
  const Recipe = recipe.builder(MockRecipe, recipe.config);
  const instance = new Recipe('upsun', {root, _app: app, ...extra.options});
  return {instance, app};
};

describe('builders/upsun', () => {
  it('picks the first configured application when several share the Landofile root', () => {
    const {instance, app} = build(fixture('flex-shared-root'));
    expect(app.upsun.closestApp).to.equal('zebra');
    expect(Object.keys(instance.config.services)[0]).to.equal('zebra');
    expect(instance.config.tooling.node.service).to.equal('zebra');
  });

  it('wires database tooling to the closest app\'s database', () => {
    const {instance} = build(fixture('flex-drupal'));
    for (const [key, script] of [['db-import <file>', 'sql-import'], ['db-export [file]', 'sql-export']]) {
      expect(instance.config.tooling[key]).to.include({service: ':host', cmd: `/helpers/${script}.sh`});
      expect(instance.config.tooling[key].options.host.default).to.equal('db');
    }
  });

  it('omits database tooling when tethered', () => {
    const {instance} = build(fixture('flex-drupal'), {}, {tethered: true});
    expect(instance.config.tooling).not.to.have.any.keys('db-import <file>', 'db-export [file]');
  });

  it('replaces pull, push and tether with unsupported messages for magento projects', () => {
    const {spawnSync} = require('child_process');
    const {instance} = build(fixture('fixed-magento'));
    for (const cmd of ['pull', 'push', 'tether']) {
      const tool = instance.config.tooling[cmd];
      expect(tool.description).to.include('not available for Adobe Commerce Cloud');
      const result = spawnSync('sh', ['-c', tool.cmd], {encoding: 'utf8'});
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
    for (const [root, config] of [['flex-full', {app: 'api', tethered: true}],
      ['flex-drupal', {}], ['flex-static', {}]]) {
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
    const tether = build(fixture('flex-app-rel'), {}, {tethered: true});
    expect(tether.instance.config.services.api.overrides.environment.PLATFORM_RELATIONSHIPS).to.equal('');
    expect(tether.app.upsun.warnings.some(warning => warning.code === 'relationship-unresolved')).to.equal(false);
  });

  it('translates a Flex project into lando services, proxy and tooling', () => {
    const {instance, app} = build(fixture('flex-drupal'), {}, {id: 'abc123'});
    const {services, proxy, tooling} = instance.config;

    expect(Object.keys(services)).to.include.members(['app', 'db', 'redis', 'mailpit']);
    expect(Object.keys(services)[0]).to.equal('app');
    expect(services.app).to.include({via: 'nginx', webroot: 'web'});
    expect(services.app.type).to.match(/^php:8\./);
    // Rendered files are written under the Lando config dir so `$` never reaches compose interpolation
    expect(services.app.config.vhosts).to.match(/\/config\/upsun\/[^/]+\/app-vhost\.conf$/);
    expect(fs.readFileSync(services.app.config.vhosts, 'utf8')).to.include('fastcgi_pass fpm:9000');
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
    expect(services.app.build_as_root_internal[0]).to.equal('apt-get update && apt-get install -y jq');
    expect(services.app.build_as_root_internal.at(-1)).to.equal('/helpers/upsun-install-cli.sh upsun');
    expect(services.app.build_internal).to.include('/helpers/upsun-hook.sh build');
    expect(services.app).to.not.have.property('run_internal');
    expect(services.app).to.not.have.any.keys('build', 'build_as_root', 'upsun');

    expect(services.mailpit).to.include({type: 'mailpit', port: 25});
    expect(services.mailpit.mailFrom).to.deep.equal(['app']);
    expect(proxy.app_nginx[0]).to.include({hostname: 'test.lndo.site', port: '80'});
    expect(proxy.mailpit[0].hostname).to.equal('mail.test.lndo.site');

    expect(tooling).to.include.all.keys(
        'php', 'composer', 'database', 'redis', 'cron <name>', 'xdebug-on', 'xdebug-off', 'upsun', 'pull', 'push');
    expect(tooling.drush.cmd).to.equal('/helpers/upsun-exec.sh /app/vendor/bin/drush');
    expect(tooling.upsun.env.UPSUN_CLI_NO_INTERACTION).to.equal('1');
    expect(app.upsun.startCommands.app.map(command => command.name))
        .to.deep.equal(['mounts', 'db-init:db', 'provisioned', 'pre_start', 'deploy']);
    expect(app.upsun).to.include({
      flavor: 'flex',
      closestApp: 'app',
      closestType: 'php',
      projectId: 'abc123',
      tethered: false,
      tetherEnvironment: 'feature-x',
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

  it('creates only apps and mailpit in tethered mode', () => {
    const {instance, app} = build(fixture('flex-drupal'), {}, {tethered: 'staging'});
    const {services, tooling} = instance.config;
    const env = services.app.overrides.environment;

    expect(Object.keys(services)).to.have.members(['app', 'mailpit']);
    expect(env).to.include({
      PLATFORM_RELATIONSHIPS: '',
      UPSUN_TETHERED: '1',
      UPSUN_TETHER_ENVIRONMENT: 'staging',
    });
    expect(env).to.not.have.property('DATABASE_HOST');
    expect(app.upsun.startCommands.app.map(command => command.name))
        .to.deep.equal(['mounts', 'tether', 'provisioned', 'pre_start', 'deploy']);
    expect(tooling.tether).to.include({service: 'app', user: 'root'});
    // the automatic tether step must carry the CLI contract the tooling has
    const tetherStep = app.upsun.startCommands.app.find(c => c.name === 'tether');
    expect(tetherStep.env).to.include({UPSUN_CLI_BINARY: 'upsun', UPSUN_CLI_TOKEN_VAR: 'UPSUN_CLI_TOKEN',
      UPSUN_CLI_CONTEXT: '1', PLATFORM_PROJECT: 'lando'});
    expect(tetherStep.env).to.have.property('UPSUN_CLI_TOKEN');
    expect(tooling).to.not.have.any.keys('database', 'redis');
    expect(app.upsun).to.include({tethered: true, tetherEnvironment: 'staging'});
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
    const {instance} = build(fixture('flex-static'));
    const {services, proxy} = instance.config;

    expect(services.site.command).to.equal('/helpers/upsun-start.sh');
    expect(services.site_nginx.type).to.equal('nginx');
    expect(services.site_nginx).to.not.have.property('overrides');
    expect(services.site_nginx).to.not.have.any.keys('build_internal', 'build_as_root_internal');
    expect(proxy.site_nginx[0]).to.include({hostname: 'test.lndo.site', port: '80'});
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

  it('honours config.app, config.overrides and extra build/run steps', () => {
    const applications = require('../lib/config/index').load(fixture('flex-multiapp')).applications;
    const selected = Object.keys(applications)[1];
    const {instance} = build(fixture('flex-multiapp'), {
      options: {build: ['echo user-build'], run: ['echo user-run'], overrides: {db: {portforward: 3307}}},
    }, {app: selected});
    const {services} = instance.config;
    const closest = Object.entries(services).find(([, service]) =>
      (service.build_internal || []).includes('echo user-build'));

    expect(closest).to.not.equal(undefined);
    expect(closest[1].run_internal).to.deep.equal(['echo user-run']);
    expect(services.db.portforward).to.equal(3307);
  });

  it('rejects unknown config.app names', () => {
    expect(() => build(fixture('flex-drupal'), {}, {app: 'nope'})).to.throw(/config\.app "nope"/);
  });

  it('gives friendly errors for missing or mixed config', () => {
    expect(() => build(fixture('no-config'))).to.throw(/No Upsun configuration found/);
    expect(() => build(fixture('mixed-config'))).to.throw(/Both \.upsun\/ and \.platform\//);
    expect(() => build(fixture('mixed-magento'))).to.throw(/Adobe Commerce \.magento/);
  });

  it('uses a specific title for unavailable PHP extensions', () => {
    expect(toLandoWarning({
      code: 'php-extension-unsupported',
      message: 'unsupported',
    }).title).to.equal('PHP extension not available locally');
  });
  it('does not tether workers or cron sidecars', () => {
    const {instance} = build(fixture('flex-full'), {}, {crons: true, app: 'app', tethered: 'staging'});
    const {services} = instance.config;
    expect(services.app.overrides.environment.UPSUN_TETHERED).to.equal('1');
    // tunnels live in the app container; sidecars would otherwise wait for a file that never appears
    expect(services['app--queue'].overrides.environment).to.not.have.property('UPSUN_TETHERED');
    expect(services['app--cron'].overrides.environment).to.not.have.property('UPSUN_TETHERED');
  });
});
