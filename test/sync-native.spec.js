'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');
const chai = require('chai');
chai.should();

const mockPlatform = path.join(__dirname, 'fixtures', 'mock-platform.sh');
const mockDbClient = path.join(__dirname, 'fixtures', 'mock-db-client.sh');

/**
 * Run a sync entrypoint with isolated CLI and database-client fakes.
 *
 * @param {string} script Sync script path.
 * @param {string[]} args Sync arguments.
 * @param {object} extraEnv Environment overrides.
 * @returns {{cli: string, db: string}} Captured command logs.
 */
function runSync(script, args, extraEnv = {}) {
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
    execFileSync('bash', [script, ...args], {
      env: {
        ...process.env,
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
    return {
      cli: fs.readFileSync(cliLog, 'utf8'),
      db: fs.existsSync(dbLog) ? fs.readFileSync(dbLog, 'utf8') : '',
    };
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}

describe('Lando-native sync scripts', () => {
  it('downloads remote databases and imports them with local clients', () => {
    const logs = runSync(path.join(__dirname, '..', 'scripts', 'upsun-pull.sh'), [
      '--env', 'dev', '-r', 'database', '-r', 'pg', '-m', 'files',
    ]);
    logs.cli.should.match(/db:dump -p project -e dev -r database -f \/tmp\/DATABASE\.sql/);
    logs.cli.should.match(/db:dump -p project -e dev -r pg -f \/tmp\/PG\.sql/);
    logs.db.should.match(/mysql --host=db --port=3306 --user=user main/);
    logs.db.should.match(/psql --host=pg --port=5432 --username=user --dbname=main --file=\/tmp\/PG\.sql/);
    logs.cli.should.match(/mount:download -p project -e dev -m files --target .*\/files -y/);
  });

  it('dumps local databases and uploads them through the remote CLI', () => {
    const logs = runSync(path.join(__dirname, '..', 'scripts', 'upsun-push.sh'), [
      '--env', 'dev', '-r', 'database', '-r', 'pg', '-m', 'files',
    ]);
    logs.db.should.match(/mysqldump --host=db --port=3306 --user=user main/);
    logs.db.should.match(/pg_dump --host=pg --port=5432 --username=user --dbname=main --file=\/tmp\/PG\.sql/);
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
});
