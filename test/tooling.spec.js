'use strict';

const {expect} = require('chai');
const tooling = require('../lib/tooling');

describe('lib/tooling', () => {
  it('quotes SQL credentials and paths without putting passwords on argv', () => {
    const host = {username: 'user\' name;', path: 'db\' name;', password: 'private-secret'};
    const app = {relationships: {database: {service: 'db'}}};
    for (const [type, cmd, variable] of [
      ['mysql:8', 'mysql -u\'user\'\\\'\' name;\' \'db\'\\\'\' name;\'', 'MYSQL_PWD'],
      ['postgres:16', 'psql -U \'user\'\\\'\' name;\' \'db\'\\\'\' name;\'', 'PGPASSWORD'],
    ]) {
      const task = tooling.getRelationshipTooling(app, {db: {type}}, {db: host}).database;
      expect(task.cmd).to.equal(cmd).and.not.include(host.password);
      expect(task.env).to.deep.equal({[variable]: host.password});
    }
    expect(tooling.getComposerTooling('app', '/app/site\' name;', ['drush/drush']).drush.cmd)
      .to.equal('/helpers/upsun-exec.sh \'/app/site\'\\\'\' name;/vendor/bin/drush\'');
  });

  it('passes optional cache passwords through env and quotes mongosh passwords', () => {
    const app = {relationships: {cache: {service: 'cache'}}};
    for (const service of [{type: 'redis:7'}, {type: 'compose', services: {image: 'valkey/valkey:8'}}]) {
      const task = tooling.getRelationshipTooling(app, {cache: service}, {cache: {password: 'secret'}}).cache;
      expect(task.env).to.deep.equal({REDISCLI_AUTH: 'secret'});
      expect(task.cmd).not.to.include('secret');
    }
    expect(tooling.getRelationshipTooling(app, {cache: {type: 'mongo:7'}},
      {cache: {password: 's\' e;'}}).cache.cmd).to.equal('mongosh --password \'s\'\\\'\' e;\'');
  });

  it('keeps Magento remote-operation stubs app-level', () => {
    for (const task of Object.values(tooling.getMagentoTooling('app'))) expect(task.level).to.equal('app');
  });

  it('runs replica relationship shells on the primary using read-only credentials', () => {
    const app = {relationships: {
      maria: {service: 'maria-replica', endpoint: 'main'}, pg: {service: 'pg-replica', endpoint: 'postgresql'},
    }};
    const services = {maria: {type: 'mariadb:11.4'}, db: {type: 'postgres:16'}};
    const hostMap = {
      'maria-replica#main': {host: 'maria', username: 'maria-replica_main', password: 'upsun', path: 'main'},
      'pg-replica#postgresql': {host: 'db', username: 'pg-replica_postgresql', password: 'upsun', path: 'main'},
    };
    const result = tooling.getRelationshipTooling(app, services, hostMap);
    expect(result.maria).to.include({service: 'maria', cmd: 'mysql -umaria-replica_main main'});
    expect(result.maria.env).to.deep.equal({MYSQL_PWD: 'upsun'});
    expect(result.pg).to.include({service: 'db', cmd: 'psql -U pg-replica_postgresql main'});
    expect(result.pg.env).to.deep.equal({PGPASSWORD: 'upsun'});
  });

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

  it('never selects a replica as the db-import or db-export target', () => {
    const model = {applications: {app: {relationships: {readonly: {service: 'replica'}}}},
      services: {replica: {type: {service: 'postgresql-replica'}}, db: {type: {service: 'postgresql'}}}};
    expect(tooling.getDatabaseTooling('app', model, {db: {type: 'postgres:16'}}))
        .to.deep.equal(databaseTooling('db'));
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

  for (const type of ['mariadb:11.4', 'mysql:8.0']) {
    it(`builds relationship shells from the host map for ${type}`, () => {
      const app = {relationships: {
        database: {service: 'db', endpoint: 'mysql'},
        pg: {service: 'pg', endpoint: 'postgresql'},
        cache: {service: 'redis', endpoint: 'redis'},
        search: {service: 'os', endpoint: 'opensearch'},
      }};
      const services = {db: {type}, pg: {type: 'postgres:16'}, redis: {type: 'redis:7.2'},
        os: {type: 'compose'}};
      const hostMap = {
        'db': {username: 'upsun', password: 'upsun', path: 'main'},
        'db#mysql': {username: 'upsun', password: 'upsun', path: 'main'},
        'pg': {username: 'postgres', password: '', path: 'main'},
        'redis': {}, 'os': {},
      };
      const result = tooling.getRelationshipTooling(app, services, hostMap);
      expect(result.database).to.deep.equal({
        service: 'db',
        description: 'Drops into a shell on the database relationship',
        cmd: 'mysql -uupsun main',
        env: {MYSQL_PWD: 'upsun'},
      });
      expect(result.pg).to.include({service: 'pg', cmd: 'psql -U postgres main'});
      expect(result.pg.env).to.deep.equal({PGPASSWORD: ''});
      expect(result.cache.cmd).to.equal('redis-cli');
      expect(result).to.not.have.property('search');
    });

    it(`omits the database from ${type} relationship shells when the endpoint path is null`, () => {
      const app = {relationships: {reports: {service: 'db', endpoint: 'reporter'}}};
      const hostMap = {'db#reporter': {username: 'reporter', password: 'upsun', path: null}};
      const result = tooling.getRelationshipTooling(app, {db: {type}}, hostMap);
      expect(result.reports).to.deep.equal({
        service: 'db',
        description: 'Drops into a shell on the reports relationship',
        cmd: 'mysql -ureporter',
        env: {MYSQL_PWD: 'upsun'},
      });
    });
  }

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
});
