'use strict';

const chai = require('chai');
chai.should();
const {getDatabaseHost, getDatabaseInit} = require('../lib/mapping/database');

const makeService = (name, type, configuration = {}) => ({
  name,
  type: {service: type, version: '1'},
  configuration,
});

describe('database initialization mapping', () => {
  it('gives SUPERUSER only to the synthetic PostgreSQL default endpoint', () => {
    getDatabaseInit(makeService('db', 'postgresql')).statements.join('\n')
        .should.include('CREATE ROLE %I LOGIN PASSWORD %L SUPERUSER');
    const configured = makeService('db', 'postgresql', {endpoints: {upsun: {privileges: {main: 'ro'}}}});
    const sql = getDatabaseInit(configured).statements.join('\n');
    sql.should.not.include('SUPERUSER');
    sql.should.not.include('GRANT ALL');
    sql.should.include('GRANT USAGE ON SCHEMA public TO "upsun";');
    sql.should.include('GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO "upsun";');
    sql.should.include('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO "upsun";');
  });

  it('resets MySQL and MariaDB grants before applying the exact privilege matrix', () => {
    for (const type of ['mysql', 'mariadb', 'oracle-mysql']) {
      for (const [level, privileges] of [
        ['ro', 'SELECT, SHOW VIEW, CREATE TEMPORARY TABLES'],
        ['rw', 'SELECT, INSERT, UPDATE, DELETE, CREATE TEMPORARY TABLES, LOCK TABLES, EXECUTE, ' +
          'SHOW VIEW, EVENT, INDEX, TRIGGER'],
        ['admin', 'ALL PRIVILEGES'],
      ]) {
        const statements = getDatabaseInit(makeService('db', type, {endpoints: {
          app: {privileges: {main: level}},
        }})).statements;
        statements.slice(1, 4).should.eql([
          'CREATE USER IF NOT EXISTS \'app\'@\'%\' IDENTIFIED BY \'upsun\';',
          'REVOKE ALL PRIVILEGES, GRANT OPTION FROM \'app\'@\'%\';',
          `GRANT ${privileges} ON \`main\`.* TO 'app'@'%';`,
        ]);
      }
    }
  });

  it('grants reader defaults for every schema owner and writer, regardless of endpoint order', () => {
    const statements = getDatabaseInit(makeService('db', 'postgresql', {
      schemas: ['main', 'other'], endpoints: {
        'reader': {privileges: {main: 'ro'}},
        'admin"user': {privileges: {main: 'admin'}},
        'writer': {privileges: {main: 'rw'}},
        'unrelated': {privileges: {other: 'admin'}},
      },
    })).statements;
    for (const owner of ['"admin""user"', '"writer"']) {
      statements.should.include(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public ` +
        'GRANT SELECT ON TABLES TO "reader";');
      statements.should.include(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public ` +
        'GRANT SELECT ON SEQUENCES TO "reader";');
    }
    statements.join('\n').should.not.include('FOR ROLE "unrelated" IN SCHEMA public GRANT SELECT');
    const lastCreate = Math.max(...statements.map((sql, index) => sql.includes('CREATE ROLE') ? index : -1));
    const firstDefault = statements.findIndex(sql => sql.startsWith('ALTER DEFAULT PRIVILEGES'));
    lastCreate.should.be.below(firstDefault);
  });

  it('escapes MySQL schema identifiers and endpoint user literals when names contain SQL metacharacters', () => {
    const schema = 'schema\'"`\\$$';
    const username = 'user\'"`\\$$';
    const service = makeService('db', 'mariadb', {
      schemas: [schema], endpoints: {[username]: {privileges: {[schema]: 'admin'}}},
    });

    const statements = getDatabaseInit(service).statements;

    statements.should.eql([
      'CREATE DATABASE IF NOT EXISTS `schema\'"``\\$$`;',
      'CREATE USER IF NOT EXISTS \'user\'\'"`\\\\$$\'@\'%\' IDENTIFIED BY \'upsun\';',
      'REVOKE ALL PRIVILEGES, GRANT OPTION FROM \'user\'\'"`\\\\$$\'@\'%\';',
      'GRANT ALL PRIVILEGES ON `schema\'"``\\\\$$`.* TO \'user\'\'"`\\\\$$\'@\'%\';',
      'FLUSH PRIVILEGES;',
    ]);
  });

  for (const privilege of ['admin', 'rw', 'ro']) {
    it(`escapes PostgreSQL names in creation and ${privilege} grants when names contain SQL metacharacters`, () => {
      const schema = 'schema\'"`\\$$';
      const username = 'user\'"`\\$$';
      const service = makeService('db', 'postgresql', {
        schemas: [schema], endpoints: {[username]: {privileges: {[schema]: privilege}}},
      });

      const statements = getDatabaseInit(service).statements;

      statements.slice(0, 2).should.eql([
        'SELECT format(\'CREATE DATABASE %I\', \'schema\'\'"`\\$$\') WHERE NOT EXISTS ' +
          '(SELECT FROM pg_database WHERE datname = \'schema\'\'"`\\$$\')\\gexec',
        'SELECT format(\'CREATE ROLE %I LOGIN PASSWORD %L\', \'user\'\'"`\\$$\', \'upsun\') ' +
          'WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = \'user\'\'"`\\$$\')\\gexec',
      ]);
      const quotedSchema = '"schema\'""`\\$$"';
      const quotedUser = '"user\'""`\\$$"';
      const grants = {
        admin: [
          `GRANT ALL PRIVILEGES ON DATABASE ${quotedSchema} TO ${quotedUser};`,
          `ALTER DATABASE ${quotedSchema} OWNER TO ${quotedUser};`,
        ],
        rw: [
          `\\connect ${quotedSchema}`,
          `REVOKE ALL ON SCHEMA public FROM ${quotedUser};`,
          `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${quotedUser};`,
          `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${quotedUser};`,
          `GRANT CONNECT ON DATABASE ${quotedSchema} TO ${quotedUser};`,
          `GRANT USAGE ON SCHEMA public TO ${quotedUser};`,
          `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quotedUser};`,
          `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${quotedUser};`,
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ${quotedUser};`,
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${quotedUser};`,
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quotedUser};`,
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${quotedUser};`,
          `ALTER DEFAULT PRIVILEGES FOR ROLE ${quotedUser} IN SCHEMA public REVOKE ALL ON TABLES FROM ${quotedUser};`,
          `ALTER DEFAULT PRIVILEGES FOR ROLE ${quotedUser} IN SCHEMA public ` +
            `REVOKE ALL ON SEQUENCES FROM ${quotedUser};`,
          `ALTER DEFAULT PRIVILEGES FOR ROLE ${quotedUser} IN SCHEMA public ` +
            `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quotedUser};`,
          `ALTER DEFAULT PRIVILEGES FOR ROLE ${quotedUser} IN SCHEMA public ` +
            `GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${quotedUser};`,
        ],
        ro: [
          `\\connect ${quotedSchema}`,
          `REVOKE ALL ON SCHEMA public FROM ${quotedUser};`,
          `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${quotedUser};`,
          `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${quotedUser};`,
          `GRANT CONNECT ON DATABASE ${quotedSchema} TO ${quotedUser};`,
          `GRANT USAGE ON SCHEMA public TO ${quotedUser};`,
          `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${quotedUser};`,
          `GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quotedUser};`,
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ${quotedUser};`,
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${quotedUser};`,
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${quotedUser};`,
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO ${quotedUser};`,
        ],
      };
      statements.slice(2).should.eql(grants[privilege]);
    });
  }

  it('escapes MySQL grant wildcards so a schema grant matches only that schema', () => {
    const service = makeService('db', 'mariadb', {
      schemas: ['my_db%'], endpoints: {app: {privileges: {'my_db%': 'rw'}}},
    });

    const statements = getDatabaseInit(service).statements;

    statements[0].should.equal('CREATE DATABASE IF NOT EXISTS `my_db%`;');
    statements.should.include('GRANT SELECT, INSERT, UPDATE, DELETE, CREATE TEMPORARY TABLES, LOCK TABLES, EXECUTE, ' +
      'SHOW VIEW, EVENT, INDEX, TRIGGER ' +
      'ON `my\\_db\\%`.* TO \'app\'@\'%\';');
  });

  it('initializes numeric schema names that YAML parses as numbers', () => {
    const mysql = getDatabaseInit(makeService('db', 'mariadb', {schemas: [2024]})).statements;
    const pgsql = getDatabaseInit(makeService('db', 'postgresql', {schemas: [2024]})).statements;

    mysql[0].should.equal('CREATE DATABASE IF NOT EXISTS `2024`;');
    mysql.should.include('GRANT ALL PRIVILEGES ON `2024`.* TO \'upsun\'@\'%\';');
    pgsql[0].should.equal('SELECT format(\'CREATE DATABASE %I\', \'2024\') WHERE NOT EXISTS ' +
      '(SELECT FROM pg_database WHERE datname = \'2024\')\\gexec');
    pgsql.should.include('ALTER DATABASE "2024" OWNER TO "upsun";');
  });

  it('initializes PostgreSQL databases and privileges without endpoint defaults', () => {
    const service = makeService('db', 'postgresql', {
      databases: ['analytics'], endpoints: {reader: {privileges: {analytics: 'ro'}}},
    });
    const statements = getDatabaseInit(service).statements;
    statements[0].should.include(`format('CREATE DATABASE %I', 'analytics')`);
    statements.should.include('\\connect "analytics"');
    statements.join('\n').should.not.include('undefined');
  });

  it('creates the default schema and an admin upsun user for MariaDB', () => {
    const service = makeService('db', 'mariadb');
    getDatabaseInit(service).should.eql({
      dialect: 'mysql',
      statements: [
        'CREATE DATABASE IF NOT EXISTS `main`;',
        `CREATE USER IF NOT EXISTS 'upsun'@'%' IDENTIFIED BY 'upsun';`,
        `REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'upsun'@'%';`,
        `GRANT ALL PRIVILEGES ON \`main\`.* TO 'upsun'@'%';`,
        'FLUSH PRIVILEGES;',
      ],
    });
    getDatabaseHost(service).should.eql({host: 'db', dialect: 'mysql'});
  });

  it('creates every configured schema and endpoint user with mapped privileges', () => {
    const service = makeService('db', 'mariadb', {
      schemas: ['main', 'legacy'],
      endpoints: {
        admin: {default_schema: 'main', privileges: {main: 'admin', legacy: 'admin'}},
        reporter: {default_schema: 'legacy', privileges: {legacy: 'ro'}},
      },
    });
    const statements = getDatabaseInit(service).statements;
    statements.slice(0, 2).should.eql([
      'CREATE DATABASE IF NOT EXISTS `main`;',
      'CREATE DATABASE IF NOT EXISTS `legacy`;',
    ]);
    statements.should.include(`GRANT ALL PRIVILEGES ON \`legacy\`.* TO 'admin'@'%';`);
    statements.should.include(`GRANT SELECT, SHOW VIEW, CREATE TEMPORARY TABLES ON \`legacy\`.* TO 'reporter'@'%';`);
    statements.at(-1).should.equal('FLUSH PRIVILEGES;');
  });

  it('creates PostgreSQL roles with password upsun and default privileges', () => {
    const service = makeService('db', 'postgresql', {
      schemas: ['main'],
      endpoints: {
        upsun: {privileges: {main: 'admin'}},
        writer: {privileges: {main: 'rw'}},
      },
    });
    const statements = getDatabaseInit(service).statements;
    statements[0].should.equal(
        `SELECT format('CREATE DATABASE %I', 'main') WHERE NOT EXISTS ` +
        `(SELECT FROM pg_database WHERE datname = 'main')\\gexec`);
    statements.should.include(
        `SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'upsun', 'upsun') ` +
        `WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'upsun')\\gexec`);
    const connect = statements.indexOf('\\connect "main"');
    statements.slice(connect, connect + 8).should.eql([
      '\\connect "main"',
      'REVOKE ALL ON SCHEMA public FROM "writer";',
      'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "writer";',
      'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM "writer";',
      'GRANT CONNECT ON DATABASE "main" TO "writer";',
      'GRANT USAGE ON SCHEMA public TO "writer";',
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "writer";',
      'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO "writer";',
    ]);
    const sql = statements.join('\n');
    sql.should.not.include('GRANT ALL ON');
    sql.should.not.include('CREATE ON SCHEMA');
    sql.should.include('ALTER DEFAULT PRIVILEGES FOR ROLE "upsun" IN SCHEMA public ' +
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "writer";');
    getDatabaseHost(service).should.eql({host: 'db', dialect: 'pgsql'});
  });

  it('returns null for non-database services', () => {
    const service = makeService('cache', 'redis');
    chai.expect(getDatabaseInit(service)).to.equal(null);
    chai.expect(getDatabaseHost(service)).to.equal(null);
  });

  it('initializes both PostgreSQL replica spellings on the primary with read-only role membership', () => {
    for (const type of ['postgres-replica', 'postgresql-replica']) {
      const service = makeService('replica', type, {
        endpoints: {postgresql: {default_database: 'main'}},
      });
      service.raw = {relationships: {primary: 'db:replicator'}};
      const primary = makeService('db', 'postgresql', {endpoints: {
        main: {privileges: {main: 'admin'}}, reader: {privileges: {main: 'ro'}},
        replicator: {replication: true}, legacy: {privileges: {main: 'replication'}},
      }});
      const model = {services: {db: primary}};
      getDatabaseHost(service, model).should.eql({host: 'db', dialect: 'pgsql'});
      const init = getDatabaseInit(service, model);
      init.dialect.should.equal('pgsql');
      const sql = init.statements.join('\n');
      sql.should.include(`format('CREATE ROLE %I LOGIN PASSWORD %L', 'replica_postgresql', 'upsun')`);
      sql.should.include('ALTER ROLE "replica_postgresql" SET default_transaction_read_only = on;');
      sql.should.include('GRANT "main" TO "replica_postgresql";');
      sql.should.include('GRANT "reader" TO "replica_postgresql";');
      sql.should.not.include('GRANT "replicator"');
      sql.should.not.include('GRANT "legacy"');
      sql.should.not.include('CREATE DATABASE');
      sql.should.not.include('SUPERUSER');
    }
  });

  it('grants the default PostgreSQL primary role and escapes replica identifiers', () => {
    const service = makeService('read"only', 'postgresql-replica');
    service.raw = {relationships: {primary: {service: 'db', endpoint: 'replicator'}}};
    const model = {services: {db: makeService('db', 'postgresql')}};
    getDatabaseInit(service, model).statements.should.include('GRANT "upsun" TO "read""only_postgresql";');
  });

  it('creates read-only MariaDB replica users without creating databases', () => {
    const service = makeService('replica', 'mariadb-replica', {endpoints: {
      main: {privileges: {'main': 'admin', 'read_%': 'rw', 'ignored': 'replication'}},
    }});
    service.raw = {relationships: {primary: 'db:replicator'}};
    const model = {services: {db: makeService('db', 'mariadb')}};
    getDatabaseHost(service, model).should.eql({host: 'db', dialect: 'mysql'});
    const sql = getDatabaseInit(service, model).statements.join('\n');
    sql.should.include('CREATE USER IF NOT EXISTS \'replica_main\'@\'%\' IDENTIFIED BY \'upsun\';');
    sql.should.include('GRANT SELECT, SHOW VIEW, CREATE TEMPORARY TABLES ON `main`.* TO \'replica_main\'@\'%\';');
    sql.should.include('GRANT SELECT, SHOW VIEW, CREATE TEMPORARY TABLES ON `read\\_\\%`.* TO \'replica_main\'@\'%\';');
    sql.should.not.include('ignored');
    sql.should.not.include('GRANT ALL PRIVILEGES');
    sql.should.not.include('CREATE DATABASE');
    sql.should.match(/FLUSH PRIVILEGES;$/);
  });

  it('falls back through replica schemas, databases, primary schemas, databases, and main', () => {
    for (const [config, primaryConfig, schema] of [
      [{schemas: ['replica_schema']}, {schemas: ['primary_schema']}, 'replica_schema'],
      [{databases: ['replica_database']}, {}, 'replica_database'],
      [{}, {schemas: ['primary_schema']}, 'primary_schema'],
      [{}, {databases: ['primary_database']}, 'primary_database'],
      [{}, {}, 'main'],
    ]) {
      const service = makeService('replica', 'mariadb-replica', config);
      service.raw = {relationships: {primary: 'db:replicator'}};
      const model = {services: {db: makeService('db', 'mysql', primaryConfig)}};
      getDatabaseInit(service, model).statements.should.include(
          `GRANT SELECT, SHOW VIEW, CREATE TEMPORARY TABLES ON \`${schema.replace(/_/g, '\\_')}\`.* ` +
            `TO 'replica_mysql'@'%';`);
      service.configuration.endpoints = {reader: {}};
      getDatabaseInit(service, model).statements.should.include(
          `GRANT SELECT, SHOW VIEW, CREATE TEMPORARY TABLES ON \`${schema.replace(/_/g, '\\_')}\`.* ` +
            `TO 'replica_reader'@'%';`);
    }
  });

  it('does not initialize or resolve invalid replica primaries', () => {
    for (const primary of [undefined, 'missing:replicator', 'db:replicator']) {
      const service = makeService('replica', 'mariadb-replica');
      service.raw = {relationships: {primary}};
      const model = {services: {db: makeService('db', 'postgresql')}};
      chai.expect(getDatabaseHost(service, model)).to.equal(null);
      chai.expect(getDatabaseInit(service, model)).to.equal(null);
    }
  });

  it('creates replication endpoint users without unsupported or malformed grants', () => {
    for (const [type, replicator] of [
      ['postgresql', {replication: true}],
      ['mariadb', {privileges: {main: 'replication'}}],
    ]) {
      const service = makeService('db', type, {endpoints: {replicator}});
      const sql = getDatabaseInit(service).statements.join('\n');
      sql.should.include('replicator');
      sql.should.not.match(/(^|\n)GRANT /);
      sql.should.not.include('undefined');
    }
  });
});
