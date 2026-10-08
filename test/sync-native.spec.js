'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync: execFileSyncRaw} = require('child_process');
const childEnv = (overrides = {}) => {
  const env = {...process.env, ...overrides};
  delete env.BASH_ENV;
  delete env.ENV;
  delete env.SHELLOPTS;
  delete env.BASHOPTS;
  return env;
};
const execFileSync = (file, args, options = {}) => execFileSyncRaw(file, args,
  {...options, timeout: 10000, env: childEnv(options.env)});
const chai = require('chai');
const describeLinux = require('./helpers/describe-linux');
chai.should();

const mockPlatform = path.join(__dirname, 'fixtures', 'mock-platform.sh');
const mockDbClient = path.join(__dirname, 'fixtures', 'mock-db-client.sh');

/**
 * Run a sync entrypoint with isolated CLI and database-client fakes.
 *
 * @param {string} script Sync script path.
 * @param {string[]} args Sync arguments.
 * @param {object} extraEnv Environment overrides.
 * @param {boolean} allowFailure Return failed command logs instead of throwing.
 * @returns {{stdout: string, status: number|null, stderr: string, artifacts: string[], cli: string, db: string}} Captured result and command logs.
 */
function runSync(script, args, extraEnv = {}, allowFailure = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-sync-'));
  const bin = path.join(root, 'bin');
  const cliLog = path.join(root, 'cli.log');
  const dbLog = path.join(root, 'db.log');
  fs.mkdirSync(bin);
  for (const client of ['mysql', 'mariadb', 'mysqldump', 'mariadb-dump', 'psql', 'pg_dump']) {
    fs.copyFileSync(mockDbClient, path.join(bin, client));
    fs.chmodSync(path.join(bin, client), 0o755);
  }
  try {
    let stdout;
    let failure;
    try {
      stdout = execFileSync('bash', [script, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        BASH_ENV: '',
        PATH: `${bin}:${process.env.PATH}`,
        UPSUN_CLI_BINARY: mockPlatform,
        UPSUN_CLI_TOKEN_VAR: 'UPSUN_CLI_TOKEN',
        UPSUN_CLI_TOKEN: 'secret',
        UPSUN_LOG_HELPER: path.join(__dirname, 'fixtures', 'log.sh'),
        MOCK_PLATFORM_LOG: cliLog,
        MOCK_DB_LOG: dbLog,
        MOCK_ACTIVE: 'dev',
        PLATFORM_PROJECT: 'project',
        PLATFORM_APP_DIR: root,
        LANDO_MOUNT: root,
        UPSUN_SYNC_TMPDIR: root,
        UPSUN_PULL_SCRIPT: path.join(__dirname, '..', 'scripts', 'upsun-pull.sh'),
        UPSUN_MYSQL_CLIENT: path.join(bin, 'mysql'),
        UPSUN_PSQL_CLIENT: path.join(bin, 'psql'),
        UPSUN_MYSQL_DUMP: path.join(bin, 'mysqldump'),
        UPSUN_PG_DUMP: path.join(bin, 'pg_dump'),
        DATABASE_HOST: 'db',
        DATABASE_PORT: '3306',
        DATABASE_USERNAME: 'user',
        DATABASE_PASSWORD: 'pass',
        DATABASE_PATH: 'main',
        DATABASE_SCHEME: 'mysql',
        PG_HOST: 'pg',
        PG_PORT: '5432',
        PG_USERNAME: 'user',
        PG_PASSWORD: 'pass',
        PG_PATH: 'main',
        PG_SCHEME: 'pgsql',
        ...extraEnv,
      },
      });
    } catch (error) {
      if (!allowFailure) throw error;
      failure = error;
      stdout = String(error.stdout);
    }
    return {
      stdout,
      status: failure ? failure.status : 0,
      stderr: failure ? String(failure.stderr) : '',
      artifacts: fs.readdirSync(root).filter(name => name.startsWith('upsun-data.')),
      cli: fs.readFileSync(cliLog, 'utf8'),
      db: fs.existsSync(dbLog) ? fs.readFileSync(dbLog, 'utf8') : '',
    };
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}

describeLinux('Lando-native sync scripts', function() {
  this.timeout(15000); // eslint-disable-line no-invalid-this
  for (const [when, overrides] of [
    ['initially', {MOCK_STATUS: 'active', MOCK_STATUS_RC: '1'}],
    ['after waking', {MOCK_STATUS: 'paused', MOCK_WAKE_STATUS: 'active', MOCK_WAKE_STATUS_RC: '1'}],
  ]) {
    it(`hard-fails when the status command prints active but fails ${when}`, () => {
      const logs = runSync(path.join(__dirname, 'fixtures/sync-harness.sh'), ['require', 'dev'], overrides, true);
      logs.status.should.equal(2);
      logs.stderr.should.include('Could not read the status');
      logs.stdout.should.not.include('Verified');
      logs.cli.should.not.match(/ parent|db:dump|db:sql/);
    });
  }
  for (const [name, extra] of [['fails', {MOCK_PARENT_RC: '1'}], ['is empty', {MOCK_PARENT: ''}]]) {
    it(`never imports a guessed parent when the parent lookup ${name}`, () => {
      const logs = runSync(path.join(__dirname, '../scripts/upsun-pull.sh'), ['-r=database', '--skip-files'],
        {MOCK_STATUS: 'paused', MOCK_RESUME_RC: '1', ...extra}, true);
      logs.status.should.equal(2);
      logs.stderr.should.include('Could not determine the parent of');
      logs.cli.should.not.include('db:dump');
      logs.db.should.equal('');
    });
  }
  for (const direction of ['pull', 'push']) {
    const script = path.join(__dirname, '..', 'scripts', `upsun-${direction}.sh`);
    it(`${direction} never falls back or syncs when a failed status command prints active`, () => {
      const logs = runSync(script, ['--skip-db', '--skip-files'], {MOCK_STATUS_RC: '1'}, true);
      logs.status.should.not.equal(0);
      logs.stderr.should.include('Could not read the status');
      logs.cli.should.not.match(/ parent|db:dump|db:sql|mount:download|mount:upload/);
    });
    it(`${direction} preserves explicit database targets for both engines`, () => {
      const logs = runSync(script, ['--env=dev', '-r=database:other,pg:analytics', '-m=none']);
      logs.cli.should.match(/-r database --schema other/);
      logs.cli.should.match(/-r pg --schema analytics/);
      logs.db.should.match(/--user=user (?:--database=|-- )other/);
      logs.db.should.include('--dbname=analytics');
      logs.artifacts.should.eql([]);
    });
    for (const relationship of ['database', 'database:']) {
      it(`${direction} rejects a missing database before any data action (${relationship})`, () => {
        const logs = runSync(script, ['--env=dev', '-r', relationship, '-m=none'], {DATABASE_PATH: ''}, true);
        logs.status.should.not.equal(0);
        logs.stderr.should.match(/database.*--relationship/i);
        logs.cli.should.not.match(/db:dump|db:sql/);
        logs.db.should.equal('');
      });
    }
    it(`${direction} warns on implicit empty selections`, () => {
      const logs = runSync(script, ['--env=dev']);
      logs.stdout.should.match(/No relationships selected.*--relationship/);
      logs.stdout.should.match(/No mounts selected.*--mount/);
      logs.cli.should.not.match(/db:dump|db:sql|mount:download|mount:upload/);
    });
    it(`${direction} does not warn on intentional skips`, () => {
      runSync(script, ['--env=dev', '-r=none', '-m=none']).stdout.should.not.include('No ');
    });
  }
  for (const [scenario, extra] of [
    ['corrupt downloads', {MOCK_BAD_GZIP: '1'}],
    ['download failures', {MOCK_DOWNLOAD_RC: '7'}],
    ['client failures', {MOCK_CLIENT_RC: '8'}],
  ]) {
    it(`rejects ${scenario} without reporting pull success`, () => {
      const script = path.join(__dirname, '..', 'scripts', 'upsun-pull.sh');
      const logs = runSync(script, ['--env=dev', '-r=database', '-m=none'], extra, true);
      logs.status.should.not.equal(0);
      logs.stdout.should.not.include('Pull completed successfully');
      logs.artifacts.should.eql([]);
      if (!extra.MOCK_CLIENT_RC) logs.db.should.equal('');
    });
  }
  it('rejects an explicit replica relationship before touching any database', () => {
    const script = path.join(__dirname, '..', 'scripts', 'upsun-pull.sh');
    const logs = runSync(script, ['--env=dev', '-r=database', '-r=readonly:main', '-m=none'],
      {UPSUN_SYNC_REPLICAS: 'readonly other', READONLY_HOST: 'db', READONLY_PORT: '3306',
        READONLY_USERNAME: 'replica', READONLY_PASSWORD: 'pass', READONLY_PATH: 'main',
        READONLY_SCHEME: 'mysql'}, true);
    logs.status.should.not.equal(0);
    logs.stderr.should.include('readonly is a read-only replica');
    logs.cli.should.not.include('db:dump');
    logs.db.should.equal('');
  });
  it('clears only selected MySQL tables and views before import with quoted names', () => {
    const logs = runSync(path.join(__dirname, '..', 'scripts', 'upsun-pull.sh'), [
      '--env=dev', '-r=database:other', '-m=none',
    ]);
    logs.db.should.include('TABLE_SCHEMA = DATABASE()');
    logs.db.should.include('REPLACE(TABLE_NAME, \'`\', \'``\')');
    logs.db.should.include('SET FOREIGN_KEY_CHECKS=0;');
    logs.db.should.include('DROP VIEW IF EXISTS `stale``view`;');
    logs.db.should.include('DROP TABLE IF EXISTS `stale``table`;');
    logs.db.indexOf('DROP TABLE IF EXISTS `stale``table`;').should.be.lessThan(logs.db.indexOf('SQL: SELECT 1;'));
    logs.db.should.not.include('DROP DATABASE');
  });
  it('wraps PostgreSQL replacement/import in a transaction with SQL error stopping enabled', () => {
    const script = path.join(__dirname, '..', 'scripts', 'upsun-pull.sh');
    const logs = runSync(script, ['--env=dev', '-r=pg', '-m=none']);
    logs.db.should.include('ON_ERROR_STOP=1');
    logs.db.should.include('--single-transaction');
    logs.db.should.not.match(/DROP (?:DATABASE|SCHEMA)|CASCADE/);
  });
  it('strips remote PostgreSQL ACLs and blob transactions while preserving COPY data', () => {
    const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'pg-dump-acl-blobs.sql'), 'utf8');
    const logs = runSync(path.join(__dirname, '..', 'scripts', 'upsun-pull.sh'), [
      '--env=dev', '-r=pg', '--skip-files',
    ], {
      UPSUN_CLI_BINARY: path.join(__dirname, 'fixtures', 'mock-platform-fixture.sh'),
      MOCK_DUMP_FILE: path.join(__dirname, 'fixtures', 'pg-dump-acl-blobs.sql'),
      UPSUN_AWK: '/usr/bin/awk',
    });
    const sql = logs.db.slice(logs.db.indexOf('SQL: ') + 'SQL: '.length);
    const cleanupEnd = sql.indexOf('$clean$;\n') + '$clean$;\n'.length;
    const copyStart = fixture.indexOf('COPY ');
    const copyEnd = fixture.indexOf('\\.\n', copyStart) + '\\.\n'.length;
    sql.should.match(/^SET ROLE "user";\nDO \$clean\$\n/);
    sql.should.include('FOREACH kind IN ARRAY');
    cleanupEnd.should.be.greaterThan('$clean$;\n'.length);
    cleanupEnd.should.be.lessThan(sql.indexOf('COPY '));
    sql.slice(sql.indexOf('COPY '), sql.indexOf('\\.\n') + '\\.\n'.length)
      .should.equal(fixture.slice(copyStart, copyEnd));
    sql.should.not.match(/remote_reader|remote_owner|Type: DEFAULT ACL;/);
    sql.slice(cleanupEnd).should.equal([
      '-- PostgreSQL database dump',
      '',
      '-- Data for Name: example; Type: TABLE DATA; Schema: public; Owner: -',
      fixture.slice(copyStart, copyEnd).trimEnd(),
      '',
      '-- Data for Name: BLOBS; Type: BLOBS; Schema: -; Owner: -',
      'SELECT pg_catalog.lo_open(\'9001\', 131072);',
      'SELECT pg_catalog.lowrite(0, \'\\xcafe\');',
      'SELECT pg_catalog.lo_close(0);',
      '',
      '-- Name: TABLE example; Type: COMMENT; Schema: public; Owner: -',
      'COMMENT ON TABLE public.example IS \'kept after ACL sections\';',
      '',
    ].join('\n'));
    logs.db.should.include('ON_ERROR_STOP=1');
    logs.db.should.include('--single-transaction');
    logs.status.should.equal(0);
    logs.artifacts.should.eql([]);
  });
  it('stops PostgreSQL SQL errors without reporting pull success', () => {
    const script = path.join(__dirname, '..', 'scripts', 'upsun-pull.sh');
    const failed = runSync(script, ['--env=dev', '-r=pg', '-m=none'], {MOCK_CLIENT_RC: '3'}, true);
    failed.status.should.not.equal(0);
    failed.stdout.should.not.include('Pull completed successfully');
  });
  for (const [scenario, extra] of [
    ['local export', {MOCK_DUMP_RC: '5'}],
    ['remote SQL', {MOCK_UPLOAD_RC: '6'}],
  ]) {
    it(`propagates ${scenario} failures`, () => {
      const logs = runSync(path.join(__dirname, '..', 'scripts', 'upsun-push.sh'), [
        '--env=dev', '-r=database', '-m=none',
      ], extra, true);
      logs.status.should.not.equal(0);
      logs.stdout.should.not.include('Push completed successfully');
      logs.artifacts.should.eql([]);
      if (extra.MOCK_DUMP_RC) logs.cli.should.not.include('db:sql');
    });
  }
  for (const args of [['dev'], ['--environment=dev'], ['--env', 'dev'], ['-e=dev'], ['-e', 'dev']]) {
    for (const skips of [['--no-db', '--no-files=true'], ['--skip-db=true', '--skip-files']]) {
      it(`switch accepts ${args.join(' ')} with ${skips.join(' ')}`, () => {
        const logs = runSync(path.join(__dirname, '..', 'scripts', 'upsun-switch.sh'), [...args, ...skips]);
        logs.cli.should.include('environment:checkout dev');
        logs.cli.should.not.include('env -I');
      });
    }
  }
  it('false switch skip flags still pull the explicitly selected data', () => {
    const logs = runSync(path.join(__dirname, '..', 'scripts', 'upsun-switch.sh'), [
      '--environment=dev', '--no-db=false', '--skip-files=false', '-r=database', '-m=files',
    ]);
    logs.cli.should.include('db:dump');
    logs.cli.should.include('mount:download');
  });
  it('intentional skips take precedence over data selectors and all mounts', () => {
    const logs = runSync(path.join(__dirname, '..', 'scripts', 'upsun-pull.sh'), [
      '--env=dev', '--skip-db=true', '-r=database', '--all-mounts', '--no-files=true', '-m=files',
    ]);
    logs.cli.should.not.match(/db:dump|mount:download/);
    logs.stdout.should.not.include('No ');
  });
  it('downloads remote databases and imports them with local clients', () => {
    const logs = runSync(path.join(__dirname, '..', 'scripts', 'upsun-pull.sh'), [
      '--env', 'dev', '-r', 'database', '-r', 'pg', '-m', 'files',
    ]);
    logs.cli.should.match(/db:dump -p project -e dev -r database --schema main --gzip -f \S+\/dump\.sql\.gz/);
    logs.cli.should.match(/db:dump -p project -e dev -r pg --schema main --gzip -f \S+\/dump\.sql\.gz/);
    logs.db.should.match(/mysql --host=db --port=3306 --user=user --database=main stdin=(?!0\b)\d+/);
    logs.db.should.match(/psql --host=pg --port=5432 --username=postgres --dbname=main .*stdin=(?!0\b)\d+/);
    logs.cli.should.match(/mount:download -p project -e dev -m files --target .*\/files -y/);
  });

  it('dumps local databases and uploads them through the remote CLI', () => {
    const logs = runSync(path.join(__dirname, '..', 'scripts', 'upsun-push.sh'), [
      '--env', 'dev', '-r', 'database', '-r', 'pg', '-m', 'files',
    ]);
    logs.db.should.match(/mysqldump --host=db --port=3306 --user=user -- main/);
    logs.db.should.match(/pg_dump --host=pg --port=5432 --username=user --dbname=main --file=\S+\/dump\.sql/);
    logs.cli.should.match(/db:sql -p project -e dev -r database/);
    logs.cli.should.match(/db:sql -p project -e dev -r pg/);
    logs.cli.should.match(/mount:upload -p project -e dev -m files --source .*\/files -y/);
  });

  it('requires --force for a production environment', () => {
    (() => runSync(path.join(__dirname, '..', 'scripts', 'upsun-push.sh'), [
      '--env', 'production', '-r', 'none', '-m', 'none',
    ], {MOCK_ACTIVE: 'production', MOCK_ENV_TYPE: 'production'})).should.throw(/without --force/);
  });

  it('allows an explicit forced push to a production environment', () => {
    const logs = runSync(path.join(__dirname, '..', 'scripts', 'upsun-push.sh'), [
      '--env', 'production', '--force', '-r', 'none', '-m', 'none',
    ], {MOCK_ACTIVE: 'production', MOCK_ENV_TYPE: 'production'});
    logs.cli.should.match(/environment:info -p project -e production type/);
  });

  it('pulls a gzip dump and streams it through gunzip into mysql', () => {
    const logs = runSync(path.join(__dirname, '..', 'scripts', 'upsun-pull.sh'), [
      '--env', 'dev', '-r', 'database', '-m', 'none',
    ], {PLATFORM_APPLICATION_NAME: 'app'});
    logs.cli.should.match(/db:dump .*-A app .*-r database --schema main --gzip -f \S+\/dump\.sql\.gz/);
    logs.db.should.match(/^mysql .*stdin=(?!0\b)\d+/m);
  });

  it('imports PostgreSQL dumps with psql -f -', () => {
    const logs = runSync(path.join(__dirname, '..', 'scripts', 'upsun-pull.sh'), [
      '--env', 'dev', '-r', 'database', '-m', 'none',
    ], {DATABASE_SCHEME: 'pgsql'});
    logs.db.should.match(/^psql .*--dbname=main .*-(?:f |file=)-.*stdin=(?!0\b)\d+/m);
  });

  it('downloads every mount at once with --all-mounts', () => {
    const logs = runSync(path.join(__dirname, '..', 'scripts', 'upsun-pull.sh'), [
      '--env', 'dev', '-r', 'none', '--all-mounts',
    ]);
    logs.cli.should.match(/mount:download .*--all --target \S+ -y/);
    logs.cli.should.not.match(/ -m /);
  });

  it('passes --app to every remote data command', () => {
    const logs = runSync(path.join(__dirname, '..', 'scripts', 'upsun-pull.sh'), [
      '--env', 'dev', '-r', 'database', '-m', '/files', '--app', 'api',
    ]);
    logs.cli.split('\n').filter(line => /db:dump|mount:download/.test(line))
      .forEach(line => line.should.match(/-A api/));
  });

  it('push sends -A on db:sql and mount:upload', () => {
    const logs = runSync(path.join(__dirname, '..', 'scripts', 'upsun-push.sh'), [
      '--env', 'dev', '-r', 'database', '-m', 'files',
    ], {PLATFORM_APPLICATION_NAME: 'app'});
    logs.cli.should.match(/db:sql .*-A app/);
    logs.cli.should.match(/mount:upload .*-A app/);
  });
});
