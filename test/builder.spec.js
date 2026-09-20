'use strict';

const {expect} = require('chai');
const path = require('path');
const recipe = require('../builders/upsun');

const fixture = name => path.join(__dirname, 'fixtures', name);

class MockRecipe {
  constructor(id, config) {
    this.id = id;
    this.config = {proxy: config.proxy, services: config.services, tooling: config.tooling};
  }
}

const build = (root, extra = {}, landoConfig = {}) => {
  const app = {
    name: 'test',
    root,
    _config: {domain: 'lndo.site', landoFile: '.lando.yml'},
    _lando: {cache: {get: () => extra.tokens || []}},
    config: {recipe: 'upsun', config: landoConfig},
    upsun: {branch: 'feature-x'},
  };
  const Recipe = recipe.builder(MockRecipe, recipe.config);
  const instance = new Recipe('upsun', {root, _app: app, ...extra.options});
  return {instance, app};
};

describe('builders/upsun', () => {
  it('translates a Flex project into lando services, proxy and tooling', () => {
    const {instance, app} = build(fixture('flex-drupal'), {}, {id: 'abc123'});
    const {services, proxy, tooling} = instance.config;

    expect(Object.keys(services)).to.include.members(['app', 'db', 'redis']);
    expect(Object.keys(services)[0]).to.equal('app');
    expect(services.app.type).to.match(/^php:8\./);
    expect(services.app.via).to.equal('nginx');
    expect(services.app.webroot).to.equal('web');
    expect(services.db.type).to.match(/^mariadb:/);
    expect(services.db.creds).to.deep.equal({user: 'upsun', password: 'upsun', database: 'main'});
    expect(services.redis.type).to.match(/^redis:/);

    const env = services.app.overrides.environment;
    expect(env.PLATFORM_APPLICATION_NAME).to.equal('app');
    expect(env.PLATFORM_PROJECT).to.equal('abc123');
    expect(env.PLATFORM_BRANCH).to.equal('feature-x');
    expect(env.PLATFORM_VENDOR).to.equal('upsun');
    expect(env.DATABASE_HOST).to.equal('db');
    expect(env.DATABASE_URL).to.equal('mysql://upsun:upsun@db:3306/main');
    expect(env.REDIS_HOST).to.equal('redis');
    const relationships = JSON.parse(Buffer.from(env.PLATFORM_RELATIONSHIPS, 'base64'));
    expect(relationships.database[0]).to.include({host: 'db', port: 3306, scheme: 'mysql', path: 'main'});

    expect(services.app.build_as_root_internal).to.include('/helpers/upsun-install-cli.sh upsun');
    expect(services.app.build_internal).to.include('/helpers/upsun-hook.sh build');
    expect(services.app.run_internal[0]).to.include('mkdir -p "/app/web/sites/default/files"');
    expect(services.app.run_internal).to.include('/helpers/upsun-hook.sh deploy');
    expect(services.app.build_as_root_internal[0]).to.include('mariadb-client');
    expect(services.app.build_as_root_internal[0]).to.include(' jq');
    expect(services.app).to.not.have.property('volumes');
    expect(services.app).to.not.have.property('upsun');

    expect(proxy.app_nginx[0]).to.include({hostname: 'app.lndo.site', port: '80'});

    expect(tooling).to.include.all.keys('php', 'composer', 'database', 'redis', 'cron <name>', 'upsun', 'pull', 'push');
    expect(tooling.upsun).to.include({service: 'app', cmd: '/helpers/upsun-exec.sh upsun', dir: '/app'});
    expect(tooling.php.cmd).to.equal('/helpers/upsun-exec.sh php');
    expect(tooling.drush.cmd).to.equal('/helpers/upsun-exec.sh /app/vendor/bin/drush');
    expect(tooling.upsun.env.UPSUN_CLI_NO_INTERACTION).to.equal('1');
    expect(tooling.pull.env.UPSUN_CLI_BINARY).to.equal('upsun');

    expect(app.upsun.flavor).to.equal('flex');
    expect(app.upsun.closestApp).to.equal('app');
  });

  it('translates a Fixed project using the platform CLI', () => {
    const {instance, app} = build(fixture('fixed-root'));
    const {services, tooling} = instance.config;
    expect(app.upsun.flavor).to.equal('fixed');
    expect(tooling).to.have.property('platform');
    expect(tooling.platform.cmd).to.equal('/helpers/upsun-exec.sh platform');
    expect(tooling.pull.env.UPSUN_CLI_TOKEN_VAR).to.equal('PLATFORMSH_CLI_TOKEN');
    const appService = Object.values(services).find(service => String(service.type).startsWith('php:'));
    expect(appService.overrides.environment.PLATFORM_VENDOR).to.equal('platformsh');
    expect(appService.overrides.environment.PLATFORM_PROJECT).to.equal('lando');
  });

  it('honours config.app, config.overrides and extra build/run steps', () => {
    const {instance} = build(fixture('flex-multiapp'), {
      options: {build: ['echo user-build'], run: ['echo user-run'], overrides: {db: {portforward: 3307}}},
    }, {app: Object.keys(require('../lib/config/index').load(fixture('flex-multiapp')).applications)[1]});
    const {services} = instance.config;
    const closest = Object.entries(services).find(([, s]) => (s.build_internal || []).includes('echo user-build'));
    expect(closest).to.not.equal(undefined);
    expect(closest[1].run_internal).to.include('echo user-run');
  });

  it('rejects unknown config.app names', () => {
    expect(() => build(fixture('flex-drupal'), {}, {app: 'nope'})).to.throw(/config\.app "nope"/);
  });

  it('gives friendly errors for missing or mixed config', () => {
    expect(() => build(fixture('no-config'))).to.throw(/No Upsun configuration found/);
    expect(() => build(fixture('mixed-config'))).to.throw(/Both \.upsun\/ and \.platform\//);
  });
});
