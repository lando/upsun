'use strict';

const {expect} = require('chai');
const tooling = require('../lib/tooling');

describe('lib/tooling', () => {
  it('adds language tooling per runtime with a working dir', () => {
    expect(tooling.getLanguageTooling('app', 'php', {dir: '/app/x'})).to.deep.equal({
      php: {service: 'app', cmd: '/helpers/upsun-exec.sh php', dir: '/app/x'},
      composer: {service: 'app', cmd: '/helpers/upsun-exec.sh composer', dir: '/app/x'},
    });
    expect(Object.keys(tooling.getLanguageTooling('app', 'node'))).to.deep.equal(['node', 'npm', 'yarn']);
    expect(tooling.getLanguageTooling('app', 'java')).to.deep.equal({});
  });

  it('builds relationship shells from the host map', () => {
    const app = {relationships: {
      database: {service: 'db', endpoint: 'mysql'},
      pg: {service: 'pg', endpoint: 'postgresql'},
      cache: {service: 'redis', endpoint: 'redis'},
      search: {service: 'os', endpoint: 'opensearch'},
    }};
    const services = {db: {type: 'mariadb:11.4'}, pg: {type: 'postgres:16'}, redis: {type: 'redis:7.2'},
      os: {type: 'compose'}};
    const hostMap = {
      'db': {username: 'upsun', password: 'upsun', path: 'main'},
      'db#mysql': {username: 'upsun', password: 'upsun', path: 'main'},
      'pg': {username: 'postgres', password: '', path: 'main'},
      'redis': {}, 'os': {},
    };
    const result = tooling.getRelationshipTooling(app, services, hostMap);
    expect(result.database).to.include({service: 'db', cmd: 'mysql -uupsun -pupsun main'});
    expect(result.pg).to.include({service: 'pg', cmd: 'psql -U postgres main'});
    expect(result.pg.env).to.deep.equal({PGPASSWORD: ''});
    expect(result.cache.cmd).to.equal('redis-cli');
    expect(result).to.not.have.property('search');
  });

  it('adds a valkey shell for compose services', () => {
    const app = {relationships: {cache: {service: 'cache', endpoint: 'valkey'}}};
    const services = {cache: {type: 'compose', services: {image: 'valkey/valkey:8'}}};
    const result = tooling.getRelationshipTooling(app, services, {cache: {}});
    expect(result.cache.cmd).to.equal('valkey-cli');
  });

  it('adds drush when composer.json requires it', () => {
    expect(tooling.getComposerTooling('app', '/app', null)).to.deep.equal({});
    expect(tooling.getComposerTooling('app', '/app', ['drupal/core'])).to.deep.equal({});
    const result = tooling.getComposerTooling('app', '/app/site', new Set(['drush/drush']), {dir: '/app/site'});
    expect(result.drush).to.deep.equal({
      service: 'app', cmd: '/helpers/upsun-exec.sh /app/site/vendor/bin/drush', dir: '/app/site',
    });
  });

  it('exposes lando cron <name> only when crons exist', () => {
    expect(tooling.getCronTooling('app', {})).to.deep.equal({});
    const result = tooling.getCronTooling('app', {crons: {queue: {}, sweep: {}}});
    expect(result['cron <name>']).to.include({service: 'app', cmd: '/helpers/upsun-cron.sh'});
    expect(result['cron <name>'].description).to.include('queue, sweep');
  });

  it('exposes lando operation <name> only when operations exist', () => {
    expect(tooling.getOperationTooling('app', {})).to.deep.equal({});
    expect(tooling.getOperationTooling('app', {operations: {a: {}, b: {}}})).to.deep.equal({
      'operation <name>': {
        service: 'app',
        description: 'Runs an Upsun runtime operation once (a, b)',
        cmd: '/helpers/upsun-operation.sh',
      },
    });
  });

  it('exposes root xdebug toggles', () => {
    expect(tooling.getXdebugTooling('app')).to.deep.equal({
      'xdebug-on': {
        service: 'app',
        description: 'Enables Xdebug (optional mode, default debug)',
        cmd: '/helpers/upsun-xdebug.sh on',
        user: 'root',
      },
      'xdebug-off': {
        service: 'app',
        description: 'Disables Xdebug',
        cmd: '/helpers/upsun-xdebug.sh off',
        user: 'root',
      },
    });
  });

  it('exposes lando tether as root with the CLI env', () => {
    const env = {UPSUN_CLI_TOKEN: 'token', UPSUN_CLI_CONTEXT: '1'};
    expect(tooling.getTetherTooling('app', env)).to.deep.equal({
      tether: {
        service: 'app',
        description: 'Opens (or refreshes) tunnels to the tethered Upsun environment; --close / --info',
        cmd: '/helpers/upsun-tether.sh',
        user: 'root',
        env,
      },
    });
  });
});
