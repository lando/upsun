'use strict';

const chai = require('chai');
chai.should();
const {getPushTask} = require('../lib/push');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync: spawnSyncRaw} = require('child_process');
const childEnv = (overrides = {}) => {
  const env = {...process.env, ...overrides};
  delete env.BASH_ENV;
  delete env.ENV;
  delete env.SHELLOPTS;
  delete env.BASHOPTS;
  return env;
};
const spawnSync = (file, args, options = {}) => spawnSyncRaw(file, args,
  {...options, timeout: 10000, env: childEnv(options.env)});
const describeLinux = require('./helpers/describe-linux');

describe('push tooling', () => {
  it('offers only primary database relationships, not replicas', () => {
    const task = getPushTask({applications: {app: {relationships: {
      readonly: {service: 'replica', endpoint: 'mysql'}, database: {service: 'db', endpoint: 'mysql'},
    }}}, services: {replica: {type: {service: 'mariadb-replica'}}, db: {type: {service: 'mariadb'}}}},
    'app', {binary: 'upsun', tokenVar: 'UPSUN_CLI_TOKEN', vendor: 'upsun'});
    task.options.relationship.interactive.choices.should.eql(['database']);
    task.options.relationship.interactive.default.should.eql([]);
  });

  it('adds the production force guard option', () => {
    const task = getPushTask({
      applications: {app: {relationships: {}, mounts: {}}},
      services: {},
    }, 'app', {binary: 'platform', tokenVar: 'PLATFORMSH_CLI_TOKEN', vendor: 'platformsh'}, []);
    task.should.include({service: 'app', cmd: '/helpers/upsun-push.sh', level: 'app'});
    task.options.force.should.include({passthrough: true, boolean: true});
    task.env.should.include({
      UPSUN_CLI_BINARY: 'platform',
      UPSUN_CLI_TOKEN_VAR: 'PLATFORMSH_CLI_TOKEN',
      PLATFORM_APPLICATION: '',
      PLATFORM_RELATIONSHIPS: '',
    });
  });

  it('inherits the new options but not --all-mounts', () => {
    const task = getPushTask({
      applications: {app: {relationships: {}, mounts: {}}},
      services: {},
    }, 'app', {binary: 'platform', tokenVar: 'PLATFORMSH_CLI_TOKEN', vendor: 'platformsh'}, []);
    task.options.should.include.keys('skip-db', 'skip-files', 'app', 'force');
    task.options.should.not.have.property('all-mounts');
    task.options['skip-db'].alias.should.eql(['no-db']);
    task.options['skip-files'].alias.should.eql(['no-files']);
  });

  it('forwards the saved account through auth without baking a token into the environment', () => {
    const task = getPushTask({
      applications: {app: {relationships: {}, mounts: {}}},
      services: {},
    }, 'app', {binary: 'platform', tokenVar: 'PLATFORMSH_CLI_TOKEN', vendor: 'platformsh', flavor: 'fixed'},
    [{token: 'first'}], undefined, {email: 'saved@example.com', token: 'saved'});
    task.env.should.not.have.property('PLATFORMSH_CLI_TOKEN');
    task.options.auth.default.should.equal('saved');
  });
});

describeLinux('push database exports', function() {
  this.timeout(15000); // eslint-disable-line no-invalid-this
  let root;
  let env;
  const fixtures = path.join(__dirname, 'fixtures');
  const run = (args = ['--skip-db']) => spawnSync('bash', [path.join(__dirname, '../scripts/upsun-push.sh'),
    '--env=feature', '--skip-files', ...args], {env, encoding: 'utf8'});

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-push-'));
    for (const client of ['pg_dump', 'mysqldump']) {
      fs.copyFileSync(path.join(fixtures, 'mock-db-client.sh'), path.join(root, client));
      fs.chmodSync(path.join(root, client), 0o755);
    }
    env = {...process.env,
      UPSUN_LOG_HELPER: path.join(fixtures, 'log.sh'),
      UPSUN_CLI_BINARY: path.join(fixtures, 'mock-platform.sh'),
      UPSUN_PG_DUMP: path.join(root, 'pg_dump'), UPSUN_SYNC_TMPDIR: root,
      UPSUN_MYSQL_DUMP: path.join(root, 'mysqldump'),
      MOCK_PLATFORM_LOG: path.join(root, 'cli.log'), MOCK_DB_LOG: path.join(root, 'db.log'),
      MOCK_UPLOAD_SQL_FILE: path.join(root, 'upload.sql'), PLATFORM_PROJECT: 'project',
      DATABASE_HOST: 'db', DATABASE_PORT: '5432', DATABASE_USERNAME: 'user',
      DATABASE_PASSWORD: 'secret', DATABASE_PATH: 'local', DATABASE_SCHEME: 'pgsql',
    };
  });
  afterEach(() => fs.rmSync(root, {recursive: true, force: true}));

  it('never falls back to a parent after the implicit push target fails to resume', () => {
    Object.assign(env, {MOCK_STATUS: 'paused', MOCK_RESUME_RC: '1', MOCK_PARENT: 'main'});
    const result = spawnSync('bash', [path.join(__dirname, '../scripts/upsun-push.sh'),
      '--skip-db', '--skip-files'], {env, encoding: 'utf8'});
    result.status.should.not.equal(0);
    result.stderr.should.include('resume it or pass --env');
    fs.readFileSync(env.MOCK_PLATFORM_LOG, 'utf8').should.not.match(/ parent|db:sql|mount:upload/);
  });

  it('preserves quoted function bodies and COPY rows while skipping whole extension comments', () => {
    env.MOCK_PG_DUMP_FILE = path.join(fixtures, 'pg-dump-quoted.sql');
    const result = run(['--relationship=database']);
    result.status.should.equal(0, result.stderr);
    const sql = fs.readFileSync(env.MOCK_UPLOAD_SQL_FILE, 'utf8');
    const fixture = fs.readFileSync(env.MOCK_PG_DUMP_FILE, 'utf8');
    sql.should.include(fixture.slice(fixture.indexOf('CREATE FUNCTION')));
    sql.should.not.include('extension comment');
    sql.should.not.include('comment continuation');
  });

  it('backs up remote MySQL data before import and deletes the safety copy on success', () => {
    env.DATABASE_SCHEME = 'mysql';
    const result = run(['--relationship=database']);
    result.status.should.equal(0, result.stderr);
    const cli = fs.readFileSync(env.MOCK_PLATFORM_LOG, 'utf8');
    cli.indexOf('db:dump').should.be.lessThan(cli.indexOf('db:sql'));
    cli.should.include('-r database --schema local -f ');
    fs.readdirSync(root).filter(file => file.startsWith('upsun-remote-backup.')).should.eql([]);
  });

  it('keeps the remote MySQL safety dump and prints its exact restore command on import failure', () => {
    Object.assign(env, {DATABASE_SCHEME: 'mysql', MOCK_UPLOAD_RC: '1'});
    const result = run(['--relationship=database', '--app=api']);
    result.status.should.not.equal(0);
    const backup = result.stderr.match(/remote backup kept at (.+)\. Restore with:/)[1];
    fs.readFileSync(backup, 'utf8').should.equal('SELECT 1;\n');
    result.stderr.should.include(`db:sql -p project -e feature -A api -r database --schema local < ${backup}`);
    fs.readdirSync(root).filter(file => file.startsWith('upsun-data.')).should.eql([]);
  });

  for (const failure of ['dump', 'copy', 'mktemp']) {
    it(`refuses a remote MySQL import when the safety ${failure} fails`, () => {
      env.DATABASE_SCHEME = 'mysql';
      if (failure === 'dump') env.MOCK_DOWNLOAD_RC = '1';
      if (failure === 'copy') env.UPSUN_CP = '/missing/cp';
      if (failure === 'mktemp') {
        env.UPSUN_MKTEMP = path.join(root, 'mktemp');
        fs.copyFileSync(path.join(fixtures, 'mock-recovery-mktemp.sh'), env.UPSUN_MKTEMP);
        fs.chmodSync(env.UPSUN_MKTEMP, 0o755);
      }
      const result = run(['--relationship=database']);
      result.status.should.not.equal(0);
      result.stderr.should.include('refusing to import');
      fs.readFileSync(env.MOCK_PLATFORM_LOG, 'utf8').should.not.include('db:sql');
    });
  }

  it('replaces PostgreSQL data in one error-stopping transaction and preserves COPY payloads', () => {
    env.MOCK_PG_DUMP_FILE = path.join(root, 'local.sql');
    fs.writeFileSync(env.MOCK_PG_DUMP_FILE, [
      'DROP EXTENSION IF EXISTS pg_trgm;', 'DROP TABLE IF EXISTS final;',
      'CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;',
      'COMMENT ON EXTENSION pg_trgm IS \'text similarity\';',
      'COPY records FROM stdin;', '-- Name: fake; Type: BLOBS;', 'BEGIN;', 'COMMIT;',
      'DROP EXTENSION IF EXISTS payload;', 'COMMENT ON EXTENSION payload IS NULL;', '\\.',
      '-- Name: objects; Type: BLOBS;', 'BEGIN;', 'SELECT lo_create(42);', 'COMMIT;',
      '-- Name: final; Type: TABLE;', 'CREATE TABLE final (id int);', '',
    ].join('\n'));
    const result = run(['--relationship=database']);
    result.status.should.equal(0, result.stderr);
    fs.readFileSync(env.MOCK_DB_LOG, 'utf8').should.include('--clean --if-exists --no-owner --no-acl');
    const sql = fs.readFileSync(env.MOCK_UPLOAD_SQL_FILE, 'utf8');
    sql.should.match(/^\\set ON_ERROR_STOP on\nBEGIN;\n/);
    sql.should.include('COPY records FROM stdin;\n-- Name: fake; Type: BLOBS;\nBEGIN;\nCOMMIT;\n' +
      'DROP EXTENSION IF EXISTS payload;\nCOMMENT ON EXTENSION payload IS NULL;\n\\.');
    sql.should.include('DROP TABLE IF EXISTS final;\nCREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;\nCOPY');
    sql.should.not.match(/^(DROP|COMMENT ON) EXTENSION pg_trgm/m);
    sql.should.include('Type: BLOBS;\nSELECT lo_create(42);');
    sql.should.match(/CREATE TABLE final \(id int\);\nCOMMIT;\n$/);
  });

  for (const [name, overrides, status, message] of [
    ['failed type lookup', {MOCK_TYPE_RC: '1'}, 7, 'retry or pass --force'],
    ['empty type', {MOCK_ENV_TYPE: ''}, 7, 'retry or pass --force'],
    ['unknown type', {MOCK_ENV_TYPE: 'unknown'}, 7, 'retry or pass --force'],
    ['production type', {MOCK_ENV_TYPE: 'production'}, 6, 'without --force'],
    ['development type', {MOCK_ENV_TYPE: 'development'}, 0, 'Push completed successfully'],
    ['staging type', {MOCK_ENV_TYPE: 'staging'}, 0, 'Push completed successfully'],
  ]) {
    it(`fails closed or proceeds appropriately for ${name}`, () => {
      Object.assign(env, overrides);
      const result = run();
      result.status.should.equal(status, result.stderr);
      (result.stdout + result.stderr).should.include(message);
      fs.readFileSync(env.MOCK_PLATFORM_LOG, 'utf8').should.not.include('db:sql');
    });
  }

  for (const branch of ['main', 'master']) {
    for (const typeStatus of ['0', '1']) {
      it(`rejects ${branch} with type lookup status ${typeStatus}`, () => {
        env.MOCK_ENV_TYPE = 'development';
        env.MOCK_TYPE_RC = typeStatus;
        const result = run(['--skip-db', `--env=${branch}`]);
        result.status.should.equal(6, result.stderr);
        (result.stdout + result.stderr).should.include(
          'Refusing to push to the production environment without --force');
      });
    }
  }

  for (const [branch, typeStatus, type] of [
      ['main', '1', 'development'],
      ['master', '0', ''],
      ['main', '0', 'unknown'],
      ['master', '0', 'production'],
  ]) {
    it(`allows --force on ${branch} with type ${type || 'empty'} and lookup status ${typeStatus}`, () => {
      env.MOCK_TYPE_RC = typeStatus;
      env.MOCK_ENV_TYPE = type;
      const result = run(['--skip-db', `--env=${branch}`, '--force']);
      result.status.should.equal(0, result.stderr);
      (result.stdout + result.stderr).should.include('Push completed successfully');
    });
  }
});
