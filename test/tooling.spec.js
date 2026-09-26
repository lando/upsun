'use strict';

const {expect} = require('chai');
const tooling = require('../lib/tooling');

describe('lib/tooling', () => {
  const databaseTooling = host => ({
    'db-import <file>': {
      service: ':host',
      description: 'Imports a dump file into an Upsun database service',
      cmd: '/helpers/sql-import.sh',
      user: 'root',
      options: {
        'host': {description: 'The database service to use', default: host, alias: ['h']},
        'no-wipe': {description: 'Do not destroy the existing database before an import', boolean: true},
      },
    },
    'db-export [file]': {
      service: ':host',
      description: 'Exports database from an Upsun database service to a file',
      cmd: '/helpers/sql-export.sh',
      user: 'root',
      options: {
        host: {description: 'The database service to use', default: host, alias: ['h']},
        stdout: {description: 'Dump database to stdout'},
      },
    },
  });

  it('adds db-import and db-export defaulting to the primary database relationship', () => {
    for (const type of ['mariadb', 'mysql', 'oracle-mysql']) {
      const model = {
        applications: {
          other: {relationships: {database: {service: 'first'}}},
          app: {relationships: {
            cache: {service: 'cache'},
            missing: {service: 'missing'},
            primary: {service: 'primary-db', endpoint: 'mysql'},
            secondary: {service: 'first', endpoint: 'mysql'},
          }},
        },
        services: {
          'first': {type: {service: 'mariadb'}},
          'cache': {type: {service: 'redis'}},
          'primary-db': {type: {service: type}},
        },
      };
      const services = {'first': {type: 'mariadb:11.4'}, 'cache': {type: 'redis:7.2'},
        'primary-db': {type: `${type === 'oracle-mysql' ? 'mysql' : 'mariadb'}:11.4`}};
      expect(tooling.getDatabaseTooling('app', model, services)).to.deep.equal(databaseTooling('primary-db'));
    }
  });

  it('falls back to the first SQL service when the app has no database relationship', () => {
    const model = {
      applications: {app: {relationships: {cache: {service: 'cache'}}}},
      services: {
        cache: {type: {service: 'redis'}},
        second: {type: {service: 'mysql'}},
        first: {type: {service: 'postgresql'}},
      },
    };
    const services = {first: {type: 'postgres:16'}, second: {type: 'mariadb:11.4'}, cache: {type: 'redis:7.2'}};
    expect(tooling.getDatabaseTooling('app', model, services)).to.deep.equal(databaseTooling('second'));
    model.applications.app = {};
    expect(tooling.getDatabaseTooling('app', model, services)).to.deep.equal(databaseTooling('second'));
  });

  it('omits database tooling when no SQL service exists', () => {
    const model = {
      applications: {app: {relationships: {database: {service: 'cache'}}}},
      services: {cache: {type: {service: 'redis'}}},
    };
    expect(tooling.getDatabaseTooling('app', model, {cache: {type: 'redis:7.2'}})).to.deep.equal({});
    expect(tooling.getDatabaseTooling('app', {applications: {app: {}}, services: {}}, {})).to.deep.equal({});
  });

  it('defaults to a postgresql relationship service', () => {
    const model = {
      applications: {app: {relationships: {database: {service: 'pg', endpoint: 'postgresql'}}}},
      services: {db: {type: {service: 'mariadb'}}, pg: {type: {service: 'postgresql'}}},
    };
    const services = {db: {type: 'mariadb:11.4'}, pg: {type: 'postgres:16'}};
    expect(tooling.getDatabaseTooling('app', model, services)).to.deep.equal(databaseTooling('pg'));
  });

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
