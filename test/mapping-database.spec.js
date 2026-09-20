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
  it('creates the default schema and an admin upsun user for MariaDB', () => {
    const service = makeService('db', 'mariadb');
    getDatabaseInit(service).should.eql({
      dialect: 'mysql',
      statements: [
        'CREATE DATABASE IF NOT EXISTS `main`;',
        `CREATE USER IF NOT EXISTS 'upsun'@'%' IDENTIFIED BY 'upsun';`,
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
    statements.should.include(`GRANT SELECT ON \`legacy\`.* TO 'reporter'@'%';`);
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
        `SELECT 'CREATE DATABASE "main"' WHERE NOT EXISTS ` +
        `(SELECT FROM pg_database WHERE datname = 'main')\\gexec`);
    statements.should.include(
        `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'upsun') ` +
        `THEN CREATE ROLE "upsun" LOGIN PASSWORD 'upsun' SUPERUSER; END IF; END $$;`);
    const connect = statements.indexOf('\\connect main');
    statements.slice(connect, connect + 6).should.eql([
      '\\connect main',
      'GRANT USAGE, CREATE ON SCHEMA public TO "writer";',
      'GRANT ALL ON ALL TABLES IN SCHEMA public TO "writer";',
      'GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "writer";',
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "writer";',
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "writer";',
    ]);
    getDatabaseHost(service).should.eql({host: 'db', dialect: 'pgsql'});
  });

  it('returns null for non-database services', () => {
    const service = makeService('cache', 'redis');
    chai.expect(getDatabaseInit(service)).to.equal(null);
    chai.expect(getDatabaseHost(service)).to.equal(null);
  });
});
