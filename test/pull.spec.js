'use strict';

const chai = require('chai');
chai.should();
const {expect} = chai;
const yargs = require('yargs/yargs');
const {getInteractive} = require('@lando/core/lib/formatters');
const pull = require('../lib/pull');
const {getPullTask} = pull;
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

const model = {
  flavor: 'flex',
  applications: {
    app: {
      relationships: {database: {service: 'db'}, cache: {service: 'redis'}},
      mounts: {'/files': {}, '/private': {}},
    },
  },
  services: {
    db: {type: {service: 'mariadb'}},
    redis: {type: {service: 'redis'}},
  },
};
const cli = {binary: 'upsun', tokenVar: 'UPSUN_CLI_TOKEN', vendor: 'upsun', projectId: 'project'};

describe('pull tooling', () => {
  it('excludes all replica types even when their endpoints match SQL endpoints', () => {
    for (const type of ['mariadb-replica', 'postgresql-replica', 'postgres-replica']) {
      const replicaModel = {...model, services: {...model.services, replica: {type: {service: type}}},
        applications: {app: {relationships: {
          readonly: {service: 'replica', endpoint: 'main'},
          endpointMatch: {service: 'replica', endpoint: 'postgresql'},
          database: {service: 'db', endpoint: 'mysql'},
        }}}};
      const task = getPullTask(replicaModel, 'app', cli);
      const options = task.options.relationship.interactive;
      options.choices.should.eql(['database']);
      options.default.should.eql(['database']);
      task.env.UPSUN_SYNC_REPLICAS.should.equal('readonly endpointMatch');
    }
  });

  it('omits the replica list when the app has no replica relationships', () => {
    getPullTask(model, 'app', cli).env.should.not.have.property('UPSUN_SYNC_REPLICAS');
  });

  it('targets the app service with isolated CLI environment', () => {
    const task = getPullTask(model, 'app', cli, [{token: 'secret'}]);
    task.should.include({service: 'app', cmd: '/helpers/upsun-pull.sh', level: 'app'});
    task.env.should.include({
      UPSUN_CLI_BINARY: 'upsun',
      UPSUN_CLI_TOKEN_VAR: 'UPSUN_CLI_TOKEN',
      PLATFORM_PROJECT: 'project',
      PLATFORM_APPLICATION: '',
      PLATFORM_RELATIONSHIPS: '',
    });
    task.env.should.not.have.property('UPSUN_CLI_TOKEN');
  });

  it('offers only database relationships and all mounts', () => {
    const task = getPullTask(model, 'app', cli, []);
    task.options.relationship.interactive.choices.should.eql(['database']);
    task.options.mount.interactive.choices.should.eql(['/files', '/private']);
  });

  it('pre-selects the first relationship and mount', () => {
    const options = getPullTask(model, 'app', cli, []).options;
    options.relationship.interactive.default.should.eql(['database']);
    options.mount.interactive.default.should.eql(['/files']);
    for (const name of ['relationship', 'mount']) {
      const {choices, default: preselected} = options[name].interactive;
      preselected.forEach(choice => choices.should.include(choice));
    }
  });

  it('pre-selects nothing when there is nothing to choose', () => {
    const bare = {
      applications: {app: {relationships: {cache: {service: 'redis'}}, mounts: {}}},
      services: {redis: {type: {service: 'redis'}}},
    };
    const options = getPullTask(bare, 'app', cli, []).options;
    options.relationship.interactive.choices.should.eql([]);
    options.relationship.interactive.default.should.eql([]);
    options.mount.interactive.choices.should.eql([]);
    options.mount.interactive.default.should.eql([]);
  });

  it('exposes --all-mounts, --skip-db, --skip-files and --app passthrough options', () => {
    const options = getPullTask(model, 'app', cli, []).options;
    options.should.include.keys('auth', 'relationship', 'mount', 'env', 'project', 'no-parent',
      'all-mounts', 'skip-db', 'skip-files', 'app');
    options.app.should.include({passthrough: true, string: true});
    options.app.alias.should.eql(['A']);
    options['skip-db'].boolean.should.equal(true);
    // Lando only copies argv flags into inquirer answers for options that carry an interactive block,
    // so the skip flags need a silent one for the relationship/mount prompts to see them
    options['skip-db'].interactive.when({}).should.equal(false);
    options['skip-db'].interactive.weight.should.be.below(options.relationship.interactive.weight);
    options['skip-files'].interactive.weight.should.be.below(options.mount.interactive.weight);
  });

  it('skips interactive prompts when --skip-db / --skip-files are given', () => {
    const options = getPullTask(model, 'app', cli, []).options;
    options.relationship.interactive.when({'skip-db': true}).should.equal(false);
    options.mount.interactive.when({'skip-files': true}).should.equal(false);
    options.relationship.interactive.when({}).should.equal(true);
    options.mount.interactive.when({}).should.equal(true);
  });

  it('no longer exports build steps', () => {
    pull.should.not.have.property('getPullBuildSteps');
  });

  it('prefers the saved account for auth without baking a token into the sync environment', () => {
    const tokens = [{token: 'first', email: 'first@example.com'}, {token: 'saved', email: 'saved@example.com'}];
    const task = getPullTask(model, 'app', cli, tokens, undefined, {email: 'saved@example.com', token: 'saved'});
    task.options.auth.default.should.equal('saved');
    task.options.auth.defaultDescription.should.equal('saved@example.com');
    task.options.should.not.have.property('browser-login');
    task.env.should.not.have.property('UPSUN_CLI_TOKEN');
  });

  it('passes cached auth defaults and selected accounts through core as --auth without task-env tokens', () => {
    const parseTooling = require('@lando/core/utils/parse-tooling-config');
    const {getPushTask} = require('../lib/push');
    const {getSwitchTask} = require('../lib/switch');
    const previous = process.argv;
    process.argv = ['node', 'lando', 'pull'];
    try {
      for (const factory of [getPullTask, getPushTask, getSwitchTask]) {
        const task = factory(model, 'app', cli, [], undefined, {email: 'saved@example.com', token: 'saved'});
        for (const options of [task.options, JSON.parse(JSON.stringify(task.options))]) {
          const answers = yargs([]).options(options).exitProcess(false).parse();
          expect(answers.auth).to.equal('saved');
          expect(parseTooling([task.cmd], task.service, options, answers)[0].command.join(' '))
            .to.include('--auth=saved');
          expect(parseTooling([task.cmd], task.service, options, {...answers, auth: 'selected'})[0].command.join(' '))
            .to.include('--auth=selected').and.not.include('--auth=saved');
          expect(task.env).not.to.have.property('UPSUN_CLI_TOKEN');
        }
      }
    } finally {
      process.argv = previous;
    }
  });

  it('aliases skip flags and suppresses prompts for --no-db without treating negation as a skip', () => {
    const options = getPullTask(model, 'app', cli, []).options;
    options['skip-db'].alias.should.eql(['no-db']);
    options['skip-files'].alias.should.eql(['no-files']);
    const parse = args => {
      const parser = yargs(args).help(false).version(false).exitProcess(false);
      void parser.argv;
      let parsed;
      parser.command({
        command: 'pull',
        builder: y => {
          for (const [name, config] of Object.entries(options)) y.option(name, config);
        },
        handler: argv => {
          parsed = argv;
        },
      });
      void parser.argv;
      return parsed;
    };
    const prompts = (args, argvList) => {
      const previous = process.argv;
      process.argv = ['node', 'lando', ...argvList];
      try {
        const argv = parse(args);
        const answers = {};
        for (const question of getInteractive(options, argv).sort((a, b) => a.weight - b.weight)) {
          question.when(answers);
        }
        return {
          database: options.relationship.interactive.when(answers),
          files: options.mount.interactive.when(answers),
          answers: {...answers},
        };
      } finally {
        process.argv = previous;
      }
    };
    expect(prompts(['pull'], ['pull'])).to.deep.equal({database: true, files: true, answers: {}});
    expect(prompts(['pull', '--skip-db'], ['pull', '--skip-db']).database).to.equal(false);
    const alias = prompts(['pull', '--no-db', '--no-files'], ['pull', '--no-db', '--no-files']);
    expect(alias.database).to.equal(false);
    expect(alias.files).to.equal(false);
    expect(alias.answers['skip-db']).to.equal(true);
    expect(alias.answers['skip-files']).to.equal(true);
    for (const value of ['true', '1']) {
      const args = ['pull', `--no-db=${value}`, `--no-files=${value}`];
      const result = prompts(args, args);
      expect(result.database).to.equal(false);
      expect(result.files).to.equal(false);
      expect(result.answers).to.include({'skip-db': true, 'skip-files': true});
    }
    for (const value of ['false', '0']) {
      const args = ['pull', `--no-db=${value}`, `--no-files=${value}`];
      const result = prompts(args, args);
      expect(result.database).to.equal(true);
      expect(result.files).to.equal(true);
      expect(result.answers).not.to.include({'skip-db': true});
      expect(result.answers).not.to.include({'skip-files': true});
    }
    const negated = prompts(['pull', '--no-skip-db', '--no-skip-files'], ['pull', '--no-skip-db', '--no-skip-files']);
    expect(negated.database).to.equal(true);
    expect(negated.files).to.equal(true);
    expect(negated.answers).to.deep.equal({});
  });
});

describeLinux('pull database imports', function() {
  this.timeout(15000); // eslint-disable-line no-invalid-this
  let root;
  let env;
  const fixtures = path.join(__dirname, 'fixtures');
  const run = () => spawnSync('bash', [path.join(__dirname, '../scripts/upsun-pull.sh'),
    '--relationship=database', '--skip-files', '--env=feature'], {env, encoding: 'utf8'});
  const log = () => fs.existsSync(env.MOCK_DB_LOG) ? fs.readFileSync(env.MOCK_DB_LOG, 'utf8') : '';

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-pull-'));
    for (const name of ['mysql', 'mysqldump', 'psql']) {
      fs.copyFileSync(path.join(fixtures, 'mock-db-client.sh'), path.join(root, name));
      fs.chmodSync(path.join(root, name), 0o755);
    }
    env = {...process.env,
      UPSUN_LOG_HELPER: path.join(fixtures, 'log.sh'),
      UPSUN_CLI_BINARY: path.join(fixtures, 'mock-platform.sh'),
      UPSUN_MYSQL_CLIENT: path.join(root, 'mysql'),
      UPSUN_MYSQL_DUMP: path.join(root, 'mysqldump'),
      UPSUN_PSQL_CLIENT: path.join(root, 'psql'),
      UPSUN_SYNC_TMPDIR: root,
      MOCK_PLATFORM_LOG: path.join(root, 'platform.log'),
      MOCK_DB_LOG: path.join(root, 'db.log'),
      MOCK_DB_ENV_LOG: path.join(root, 'passwords.log'),
      PLATFORM_PROJECT: 'project',
      DATABASE_HOST: 'database.internal', DATABASE_PORT: '3306', DATABASE_USERNAME: 'endpoint',
      DATABASE_PASSWORD: 'secret', DATABASE_PATH: 'local', DATABASE_SCHEME: 'mysql',
    };
  });
  afterEach(() => fs.rmSync(root, {recursive: true, force: true}));

  it('downloads only after a single wake and dirty readiness retries finish', () => {
    env.MOCK_STATUS_SEQUENCE = 'paused dirty dirty active';
    env.UPSUN_SLEEP = 'true';
    const result = run();
    expect(result.status, result.stderr).to.equal(0);
    const calls = fs.readFileSync(env.MOCK_PLATFORM_LOG, 'utf8');
    expect(calls.match(/environment:resume/g)).to.have.length(1);
    expect(calls.match(/ status/g)).to.have.length(4);
    expect(calls.lastIndexOf(' status')).to.be.below(calls.indexOf('db:dump'));
    expect(log()).to.include('SQL: SELECT 1;');
  });

  it('aborts a pull on Ctrl-C during readiness without downloading or importing', () => {
    const sleep = path.join(root, 'sleep');
    fs.writeFileSync(sleep, '#!/bin/bash\nkill -INT "$PPID"\n', {mode: 0o755});
    env.UPSUN_SLEEP = sleep;
    env.MOCK_STATUS_SEQUENCE = 'dirty active';
    const result = run();
    expect(result.status).to.equal(130);
    expect(log()).to.equal('');
    expect(fs.readFileSync(env.MOCK_PLATFORM_LOG, 'utf8')).not.to.match(/db:dump| parent/);
  });

  for (const status of ['dirty', 'deleting', 'empty', 'fail-active', 'paused', 'inactive']) {
    it(`does not download or import when a readiness retry remains ${status}`, () => {
      env.MOCK_STATUS_SEQUENCE = `dirty ${status}`;
      env.UPSUN_SLEEP = 'true';
      const result = run();
      expect(result.status).not.to.equal(0);
      expect(log()).to.equal('');
      expect(fs.readFileSync(env.MOCK_PLATFORM_LOG, 'utf8')).not.to.match(/db:dump| parent/);
    });
  }

  it('keeps the local backup and reports its path when SIGTERM interrupts import', () => {
    env.MOCK_DB_TERM_CALL = '3';
    const result = run();
    expect(result.status).to.equal(143);
    const backup = result.stderr.match(/Local backup kept at (.+)/)[1];
    expect(fs.readFileSync(backup, 'utf8')).to.equal('SELECT 2;\n');
    expect(path.basename(backup)).to.match(/^upsun-backup\..+\.sql$/);
    expect(fs.readdirSync(root).filter(name => name.startsWith('upsun-data.'))).to.have.length(0);
  });

  it('backs up tables, views and triggers before clearing when the pull succeeds', () => {
    // Given the configured local endpoint.
    // When the pull imports the remote dump.
    const result = run();
    // Then the backup precedes cleanup and the remote SQL is imported once.
    expect(result.status, result.stderr).to.equal(0);
    expect(log()).to.match(/^mysqldump --host=database.internal --port=3306 --user=endpoint /);
    expect(log()).to.include('--single-transaction --no-tablespaces -- local');
    expect(log()).not.to.include('--routines');
    expect(log()).not.to.include('--events');
    expect(log().indexOf('mysqldump')).to.be.below(log().indexOf('DROP '));
    expect(log()).to.include('DROP VIEW IF EXISTS `stale``view`;');
    expect(log()).to.include('SQL: SELECT 1;');
    expect(log()).not.to.include('SQL: SELECT 2;');
    expect(fs.readFileSync(env.MOCK_DB_ENV_LOG, 'utf8')).to.include('MYSQL_PWD=secret');
  });

  for (const [condition, overrides] of [
    ['the backup fails', {MOCK_DUMP_RC: '1'}],
    ['the dump client is missing', {UPSUN_MYSQL_DUMP: '/missing/mysqldump'}],
    ['the remote dump is corrupt', {MOCK_BAD_GZIP: '1'}],
  ]) {
    it(`leaves local data untouched when ${condition}`, () => {
      // Given a failure before cleanup.
      Object.assign(env, overrides);
      // When the pull runs.
      const result = run();
      // Then no destructive client call occurs.
      expect(result.status).not.to.equal(0);
      expect(log()).not.to.include('DROP ');
      expect(log()).not.to.include('SQL:');
      if (!env.MOCK_BAD_GZIP) expect(result.stderr).to.include('refusing to clear local data');
    });
  }

  it('refuses cleanup when the downloaded SQL is empty', () => {
    // Given a valid gzip containing no SQL.
    env.MOCK_DUMP_SQL_FILE = path.join(root, 'empty.sql');
    fs.writeFileSync(env.MOCK_DUMP_SQL_FILE, '');
    // When the pull runs.
    const result = run();
    // Then no local client is called.
    expect(result.status).not.to.equal(0);
    expect(log()).to.equal('');
    expect(result.stderr).to.include('Empty database dump');
  });

  for (const [condition, call] of [['drop-list generation fails', '1'],
    ['cleanup fails partway through', '2'], ['the remote import fails', '3']]) {
    it(`restores the previous database when ${condition}`, () => {
      // Given one failed destructive attempt.
      env.MOCK_DB_FAIL_CALLS = call;
      // When the pull runs.
      const result = run();
      // Then cleanup is re-queried and the backup is loaded, but the pull fails.
      expect(result.status).not.to.equal(0);
      expect(log().match(/information_schema.tables/g)).to.have.length(2);
      expect(log()).to.include('SQL: SELECT 2;');
      expect(result.stderr).to.include('previous local data was restored');
      if (call === '3') expect(log()).to.include('DROP TABLE IF EXISTS `partial_import`;');
    });
  }

  for (const [condition, calls] of [['restore drop-list generation fails', '3 4'],
    ['restore cleanup fails', '3 5'], ['loading the backup fails', '3 6']]) {
    it(`keeps a recovery copy outside the removed temp directory when ${condition}`, () => {
      // Given a failed import and failed restoration.
      env.MOCK_DB_FAIL_CALLS = calls;
      // When the pull runs.
      const result = run();
      // Then the printed recovery file survives EXIT cleanup.
      expect(result.status).not.to.equal(0);
      expect(result.stderr).to.include('Restore failed for database:local');
      const backup = result.stderr.match(/Local backup kept at (.+)/)[1];
      expect(fs.readFileSync(backup, 'utf8')).to.equal('SELECT 2;\n');
      expect(fs.readdirSync(root).filter(name => name.startsWith('upsun-data.'))).to.have.length(0);
    });
  }

  for (const failure of ['copy', 'mktemp']) {
    it(`refuses to clear local data when the backup ${failure} fails`, () => {
      // Given an unavailable recovery file operation.
      if (failure === 'copy') env.UPSUN_CP = '/missing/cp';
      else {
        env.UPSUN_MKTEMP = path.join(root, 'mktemp');
        fs.copyFileSync(path.join(fixtures, 'mock-recovery-mktemp.sh'), env.UPSUN_MKTEMP);
        fs.chmodSync(env.UPSUN_MKTEMP, 0o755);
      }
      // When the pull runs.
      const result = run();
      // Then nothing is dropped and the temp directory is cleaned up.
      expect(result.status).not.to.equal(0);
      expect(result.stderr).to.include('refusing to clear local data');
      expect(log()).not.to.include('information_schema.tables');
      expect(fs.readdirSync(root).filter(name => name.startsWith('upsun-data.'))).to.have.length(0);
    });
  }

  for (const user of ['endpoint', 'upsun', 'end"point\\role']) {
    it(`imports PostgreSQL objects as the quoted endpoint ${user} using a superuser connection`, () => {
      // Given an endpoint role and PostgreSQL connection.
      Object.assign(env, {DATABASE_SCHEME: 'pgsql', DATABASE_USERNAME: user, DATABASE_PORT: '5432'});
      // When the pull runs.
      const result = run();
      // Then the connection is privileged but ordinary SQL runs as the endpoint.
      expect(result.status).to.equal(0);
      expect(log()).to.include('--username=postgres --dbname=local -X -v ON_ERROR_STOP=1 --single-transaction');
      expect(log()).to.include(`SQL: SET ROLE "${user.replaceAll('"', '""')}";\nDO $clean$`);
      expect(fs.readFileSync(env.MOCK_DB_ENV_LOG, 'utf8')).to.include('PGPASSWORD=\n');
    });
  }

  it('switches extension privileges by section without changing COPY data or atomic filtering', () => {
    // Given extension drops, multiline comments, ACLs, blobs and misleading COPY rows.
    Object.assign(env, {DATABASE_SCHEME: 'postgresql', UPSUN_PG_SUPERUSER: 'admin'});
    env.MOCK_DUMP_SQL_FILE = path.join(root, 'remote.sql');
    fs.writeFileSync(env.MOCK_DUMP_SQL_FILE, [
      'DROP EXTENSION IF EXISTS example;',
      '-- Name: example; Type: EXTENSION; Schema: -; Owner: -', 'CREATE EXTENSION example;',
      '-- Name: EXTENSION example; Type: COMMENT; Schema: -; Owner: -',
      'COMMENT ON EXTENSION example IS \'first', 'second\';',
      '-- Name: records; Type: TABLE; Schema: public; Owner: -', 'CREATE TABLE records (value text);',
      'COPY records (value) FROM stdin;', 'DROP EXTENSION x;',
      '-- Name: x; Type: EXTENSION; Schema: -; Owner: -', '\\.',
      '-- Name: records; Type: ACL; Schema: public; Owner: -', 'GRANT SELECT ON records TO remote;',
      '-- Name: public; Type: DEFAULT ACL; Schema: public; Owner: -',
      'ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO remote;',
      '-- Name: -; Type: BLOBS; Schema: -; Owner: -', 'BEGIN;', 'SELECT lo_create(42);', 'COMMIT;',
      '-- Name: final; Type: EXTENSION; Schema: -; Owner: -', 'CREATE EXTENSION final;', '',
    ].join('\n'));
    // When the pull transforms and imports the dump.
    const result = run();
    // Then only extension SQL is privileged and COPY payload is byte-for-byte SQL text.
    expect(result.status).to.equal(0);
    const sql = log().slice(log().indexOf('SQL: '));
    expect(log()).to.include('--username=admin');
    expect(sql).to.include('RESET ROLE;\nDROP EXTENSION IF EXISTS example;\nSET ROLE "endpoint";');
    expect(sql).to.include('RESET ROLE;\n-- Name: example; Type: EXTENSION;');
    expect(sql).not.to.include('COMMENT ON EXTENSION example');
    expect(sql).not.to.include('second\';');
    expect(sql).to.include('COPY records (value) FROM stdin;\nDROP EXTENSION x;\n' +
      '-- Name: x; Type: EXTENSION; Schema: -; Owner: -\n\\.');
    expect(sql).not.to.include('TO remote');
    expect(sql).not.to.include('\nBEGIN;');
    expect(sql).not.to.include('\nCOMMIT;');
    expect(sql).to.include('SELECT lo_create(42);');
    expect(sql.trim()).to.match(/CREATE EXTENSION final;\nSET ROLE "endpoint";$/);
  });

  it('preserves quoted function bodies and COPY rows while dropping whole extension comments', () => {
    Object.assign(env, {DATABASE_SCHEME: 'pgsql',
      MOCK_DUMP_SQL_FILE: path.join(fixtures, 'pg-dump-quoted.sql')});
    const result = run();
    expect(result.status, result.stderr).to.equal(0);
    const fixture = fs.readFileSync(env.MOCK_DUMP_SQL_FILE, 'utf8');
    expect(log()).to.include(fixture.slice(fixture.indexOf('CREATE FUNCTION')));
    expect(log()).not.to.include('extension comment');
    expect(log()).not.to.include('comment continuation');
  });

  it('cleans non-extension routines, standalone types and large objects before repeat PostgreSQL imports', () => {
    env.DATABASE_SCHEME = 'pgsql';
    const result = run();
    expect(result.status, result.stderr).to.equal(0);
    const sql = log();
    expect(sql).to.include('FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace');
    expect(sql).to.include('d.classid = \'pg_proc\'::regclass');
    expect(sql).to.include('CASE item.prokind WHEN \'p\' THEN \'PROCEDURE\' ELSE \'FUNCTION\' END');
    expect(sql).to.include('t.typtype IN (\'e\', \'d\', \'c\')');
    expect(sql).to.include('c.relkind IN (\'r\', \'v\', \'m\', \'p\')');
    expect(sql).to.include('d.classid = \'pg_type\'::regclass');
    expect(sql).to.include('AND d.objid = t.oid AND d.deptype = \'e\'');
    expect(sql).to.include('WHERE n.nspname = \'public\'');
    expect(sql).to.include('CASE item.typtype WHEN \'d\' THEN \'DOMAIN\' ELSE \'TYPE\' END');
    expect(sql).to.include('PERFORM lo_unlink(oid) FROM pg_largeobject_metadata;');
    expect(sql.indexOf('FROM pg_proc')).to.be.below(sql.indexOf('FROM pg_type'));
    expect(sql).not.to.include('CASCADE');
  });

  it('preserves quotes and backslashes when awk restores the endpoint role', () => {
    // Given extension SQL and a role with SQL quotes and awk escape sequences.
    Object.assign(env, {DATABASE_SCHEME: 'pgsql', DATABASE_USERNAME: 'end"point\\role'});
    env.MOCK_DUMP_SQL_FILE = path.join(root, 'extension.sql');
    fs.writeFileSync(env.MOCK_DUMP_SQL_FILE, 'DROP EXTENSION IF EXISTS example;\n');
    // When the import filter restores privileges after extension SQL.
    const result = run();
    // Then awk emits the exact quoted role, without interpreting its backslash.
    expect(result.status).to.equal(0);
    expect(log()).to.include('RESET ROLE;\nDROP EXTENSION IF EXISTS example;\nSET ROLE "end""point\\role";');
  });
});
