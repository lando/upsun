'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawn, spawnSync} = require('child_process');
const chai = require('chai');
chai.should();

const fixtures = path.join(__dirname, 'fixtures');
const script = path.join(__dirname, '..', 'scripts', 'upsun-db-init.sh');
const roots = [];

const temporaryRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-db-init-'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  for (const client of ['mysql', 'psql']) {
    fs.copyFileSync(path.join(fixtures, 'mock-sql-client.sh'), path.join(bin, client));
    fs.chmodSync(path.join(bin, client), 0o755);
  }
  roots.push(root);
  return {root, bin};
};

const run = (args, root, bin, extraEnv = {}) => spawnSync('bash', [script, ...args], {
  encoding: 'utf8',
  env: {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    UPSUN_LOG_HELPER: path.join(fixtures, 'log.sh'),
    UPSUN_MYSQL_CLIENT: path.join(bin, 'mysql'),
    UPSUN_PSQL_CLIENT: path.join(bin, 'psql'),
    MOCK_SQL_LOG: path.join(root, 'sql.log'),
    ...extraEnv,
  },
});

describe('database initialization helper', function() {
  // Cases wait on real sleeps and UPSUN_DB_WAIT timeouts
  this.timeout(20000); // eslint-disable-line no-invalid-this

  afterEach(() => {
    while (roots.length > 0) fs.rmSync(roots.pop(), {recursive: true, force: true});
  });

  it('waits for MariaDB then applies the decoded SQL as root', () => {
    const {root, bin} = temporaryRoot();
    const ready = path.join(root, 'ready');
    spawn('bash', ['-c', 'sleep 1.5; touch "$1"', 'bash', ready]);
    const sql = 'CREATE DATABASE IF NOT EXISTS `main`;\n';
    const result = run(['db', 'mysql', Buffer.from(sql).toString('base64')], root, bin, {
      UPSUN_DB_WAIT: '10',
      MOCK_SQL_READY_AFTER: ready,
    });

    result.status.should.equal(0);
    const log = fs.readFileSync(path.join(root, 'sql.log'), 'utf8');
    log.match(/mysql -h db -u root --skip-password -e SELECT 1/g).length.should.be.at.least(2);
    log.should.contain('mysql -h db -u root --skip-password\n');
    fs.readFileSync(path.join(root, 'sql.log.sql'), 'utf8').should.equal(sql);
  });

  it('applies PostgreSQL scripts with ON_ERROR_STOP', () => {
    const {root, bin} = temporaryRoot();
    const sql = 'SELECT 2;\n';
    const result = run(['db', 'pgsql', Buffer.from(sql).toString('base64')], root, bin);

    result.status.should.equal(0);
    fs.readFileSync(path.join(root, 'sql.log'), 'utf8')
      .should.match(/^psql -v ON_ERROR_STOP=1 -h db -U postgres -d postgres -f /m);
    fs.readFileSync(path.join(root, 'sql.log.sql'), 'utf8').should.equal(sql);
  });

  it('fails with exit 4 when the database never answers', () => {
    const {root, bin} = temporaryRoot();
    const result = run(['db', 'mysql', Buffer.from('SELECT 1;').toString('base64')], root, bin, {
      UPSUN_DB_WAIT: '2',
      MOCK_SQL_READY_AFTER: path.join(root, 'missing'),
    });

    result.status.should.equal(4);
    result.stderr.should.contain('RED Database db did not accept connections after 2s');
  });

  it('rejects unknown dialects', () => {
    const {root, bin} = temporaryRoot();
    run(['db', 'sqlite', Buffer.from('SELECT 1;').toString('base64')], root, bin).status.should.equal(2);
  });
});
