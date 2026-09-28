'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');
const chai = require('chai');
chai.should();

const {getPullTask} = require('../lib/pull');
const {getPushTask} = require('../lib/push');
const describeLinux = require('./helpers/describe-linux');

const harness = path.join(__dirname, 'fixtures', 'sync-harness.sh');
const mockPlatform = path.join(__dirname, 'fixtures', 'mock-platform.sh');
const pullSrc = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'upsun-pull.sh'), 'utf8');
const pushSrc = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'upsun-push.sh'), 'utf8');
const helperSrc = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'upsun-sync-env.sh'), 'utf8');
const model = {
  applications: {app: {relationships: {database: {service: 'db'}}, mounts: {'/files': {}}}},
  services: {db: {type: {service: 'mariadb'}}},
};
const cli = {binary: 'platform', tokenVar: 'PLATFORMSH_CLI_TOKEN', vendor: 'platformsh', projectId: 'proj123'};

/**
 * Run the bash sync harness.
 *
 * @param {string[]} args Harness argv (mode + args).
 * @param {object} extraEnv Extra env vars.
 * @returns {string} Combined stdout.
 */
function runHarness(args, extraEnv = {}) {
  return execFileSync('bash', [harness, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      UPSUN_CLI_BINARY: mockPlatform,
      UPSUN_CLI_TOKEN_VAR: 'PLATFORMSH_CLI_TOKEN',
      UPSUN_LOG_HELPER: path.join(__dirname, 'fixtures', 'log.sh'),
      ...extraEnv,
    },
  });
}

describe('pull/push shell contract', () => {
  it('selects the injected CLI binary and token variable', () => {
    helperSrc.should.match(/UPSUN_CLI_BINARY="\$\{UPSUN_CLI_BINARY:-platform\}"/);
    helperSrc.should.match(/UPSUN_CLI_TOKEN_VAR/);
  });

  it('unsets PLATFORM_RELATIONSHIPS and PLATFORM_APPLICATION during sync', () => {
    pullSrc.should.match(/unset PLATFORM_RELATIONSHIPS/);
    pullSrc.should.match(/unset PLATFORM_APPLICATION/);
    pushSrc.should.match(/unset PLATFORM_RELATIONSHIPS/);
    pushSrc.should.match(/unset PLATFORM_APPLICATION/);
  });

  it('assigns space-form -r / -m / --env / --project values', () => {
    helperSrc.should.match(/-r\|--relationship\)/);
    helperSrc.should.match(/upsun_append_csv PLATFORM_SYNC_RELATIONSHIPS "\$2"/);
    helperSrc.should.match(/upsun_append_csv PLATFORM_SYNC_MOUNTS "\$2"/);
    helperSrc.should.match(/PLATFORM_BRANCH="\$2"/);
    helperSrc.should.match(/PLATFORM_PROJECT="\$2"/);
  });

  it('binds the selected project through the CLI', () => {
    helperSrc.should.match(/project:set-remote/);
    helperSrc.should.match(/-p "\$PLATFORM_PROJECT"/);
  });
});

describeLinux('upsun_parse_sync_args', () => {
  it('parses space-form relationship and mount flags', () => {
    const out = runHarness(['parse', '-r', 'database', '-m', 'web/sites/default/files']);
    out.should.match(/RELS=database/);
    out.should.match(/MOUNTS=web\/sites\/default\/files/);
  });

  it('parses equals-form and SOURCE:TARGET values', () => {
    const out = runHarness([
      'parse',
      '--relationship=admin:legacy',
      '--mount=tmp:/var/www/tmp',
    ]);
    out.should.match(/RELS=admin:legacy/);
    out.should.match(/MOUNTS=tmp:\/var\/www\/tmp/);
  });

  it('appends multiple -r / -m flags', () => {
    const out = runHarness(['parse', '-r', 'database', '-r', 'migrate', '-m', 'tmp', '-m', 'private']);
    out.should.match(/RELS=database migrate/);
    out.should.match(/MOUNTS=tmp private/);
  });

  it('parses --project, --env, --no-parent, and --force', () => {
    const out = runHarness(['parse', '--project', 'abc123', '--env', 'feat', '--no-parent', '--force']);
    out.should.match(/PROJECT=abc123/);
    out.should.match(/BRANCH=feat/);
    out.should.match(/NO_PARENT=1/);
    out.should.match(/FORCE=1/);
    out.should.match(/ENV_EXPLICIT=1/);
  });

  it('parses --auth space-form and equals-form', () => {
    runHarness(['parse', '--auth', 'tok-space']).should.match(/AUTH=tok-space/);
    runHarness(['parse', '--auth=tok-eq']).should.match(/AUTH=tok-eq/);
  });

  it('parses --all-mounts, --skip-db, --skip-files and --app', () => {
    const out = runHarness(['parse', '--all-mounts', '--skip-db', '--skip-files', '--app', 'api']);
    ['ALL_MOUNTS=1', 'RELS=none', 'MOUNTS=none', 'APP=api'].forEach(value => out.should.include(value));
    ['-A=web', '--app=web'].forEach(arg => runHarness(['parse', arg]).should.match(/APP=web/));
  });

  it('defaults the app to PLATFORM_APPLICATION_NAME', () => {
    runHarness(['parse'], {PLATFORM_APPLICATION_NAME: 'app'}).should.match(/APP=app/);
  });

  it('leaves relationships and mounts empty when -r / -m are omitted', () => {
    const out = runHarness(['parse']);
    out.should.match(/^RELS=$/m);
    out.should.match(/^MOUNTS=$/m);
  });

  it('keeps a literal none for -r / -m so the sync step can skip it', () => {
    const out = runHarness(['parse', '-r', 'none', '-m', 'none']);
    out.should.match(/^RELS=none$/m);
    out.should.match(/^MOUNTS=none$/m);
  });

  it('skips empty -r / -m values', () => {
    const out = runHarness(['parse', '-r', '', '-m', '']);
    out.should.match(/^RELS=$/m);
    out.should.match(/^MOUNTS=$/m);
  });

  it('splits comma-separated -r / -m values', () => {
    const out = runHarness(['parse', '-r', 'database,migrate', '-m', 'tmp,private']);
    out.should.match(/^RELS=database migrate$/m);
    out.should.match(/^MOUNTS=tmp private$/m);
  });

  it('parses -e / -p short forms and lets a later --environment win', () => {
    const out = runHarness(['parse', '-p', 'proj9', '-e', 'feat', '--environment', 'other']);
    out.should.match(/^PROJECT=proj9$/m);
    out.should.match(/^BRANCH=other$/m);
    out.should.match(/^ENV_EXPLICIT=1$/m);
  });

  it('ignores unknown flags and leftover positionals', () => {
    const out = runHarness(['parse', 'positional', '-r', 'database', '--wat', '-m', 'tmp']);
    out.should.match(/^RELS=database$/m);
    out.should.match(/^MOUNTS=tmp$/m);
  });

  it('stops parsing after --', () => {
    const out = runHarness(['parse', '-r', 'database', '--', '--mount=tmp']);
    out.should.match(/^RELS=database$/m);
    out.should.match(/^MOUNTS=$/m);
  });
});

describe('sync source contracts', () => {
  it('uses gzip dumps, app arguments and tether guards', () => {
    pullSrc.should.match(/(?=[\s\S]*db:dump .*--gzip)(?=[\s\S]*gunzip -c)(?=[\s\S]*UPSUN_TETHERED)/);
    pushSrc.should.match(/UPSUN_TETHERED/);
    helperSrc.should.match(/upsun_app_args\(\)/);
  });
});

describeLinux('upsun_ensure_active_environment', () => {
  /**
   * Run ensure with a fresh mock log.
   *
   * @param {string} branch Environment id.
   * @param {object} extraEnv Mock behavior.
   * @returns {{out: string, log: string}}
   */
  function ensure(branch, extraEnv = {}) {
    const log = path.join(os.tmpdir(), `mock-platform-${process.pid}-${Date.now()}.log`);
    try {
      const out = runHarness(['ensure', branch], {MOCK_PLATFORM_LOG: log, ...extraEnv});
      const logged = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
      return {out, log: logged};
    } finally {
      try {
        fs.unlinkSync(log);
      } catch {
        // ignore
      }
      try {
        fs.unlinkSync(`${log}.woken`);
      } catch {
        // ignore
      }
    }
  }

  it('keeps an already-active branch', () => {
    const {out, log} = ensure('feat', {MOCK_ACTIVE: 'feat'});
    out.should.match(/BRANCH=feat/);
    log.should.not.match(/environment:resume/);
    log.should.not.match(/environment:activate/);
  });

  it('resumes a paused environment before falling back', () => {
    const {out, log} = ensure('feat', {MOCK_ACTIVE: '', MOCK_STATUS: 'paused', MOCK_RESUME_RC: '0'});
    out.should.match(/BRANCH=feat/);
    log.should.match(/environment:resume/);
  });

  it('activates an inactive environment before falling back', () => {
    const {out, log} = ensure('feat', {MOCK_ACTIVE: '', MOCK_STATUS: 'inactive', MOCK_ACTIVATE_RC: '0'});
    out.should.match(/BRANCH=feat/);
    log.should.match(/environment:activate/);
  });

  it('falls back to parent when resume fails and parent is active', () => {
    const {out, log} = ensure('feat', {
      MOCK_ACTIVE: 'main',
      MOCK_STATUS: 'paused',
      MOCK_RESUME_RC: '1',
      MOCK_PARENT: 'main',
    });
    out.should.match(/BRANCH=main/);
    log.should.match(/environment:resume/);
  });

  it('hard-fails when resume succeeds but env is still not in the active list', () => {
    let failed = false;
    try {
      ensure('feat', {
        MOCK_ACTIVE: '',
        MOCK_STATUS: 'paused',
        MOCK_RESUME_RC: '0',
        MOCK_WAKE_NO_LIST: '1',
        UPSUN_SYNC_NO_PARENT: '1',
      });
    } catch (error) {
      failed = true;
      String(error.stderr || error.message).should.match(/parent fallback is disabled/);
    }
    failed.should.equal(true);
  });

  it('hard-fails when parent is not active and cannot be woken', () => {
    let failed = false;
    try {
      ensure('feat', {
        MOCK_ACTIVE: '',
        MOCK_STATUS: 'paused',
        MOCK_RESUME_RC: '1',
        MOCK_PARENT: 'main',
      });
    } catch (error) {
      failed = true;
      String(error.stderr || error.message).should.match(/Could not verify main is an active environment/);
    }
    failed.should.equal(true);
  });

  it('does not fall back when --no-parent is set', () => {
    let failed = false;
    try {
      ensure('feat', {
        MOCK_ACTIVE: '',
        MOCK_STATUS: 'paused',
        MOCK_RESUME_RC: '1',
        UPSUN_SYNC_NO_PARENT: '1',
      });
    } catch (error) {
      failed = true;
      String(error.stderr || error.message).should.match(/parent fallback is disabled/);
    }
    failed.should.equal(true);
  });

  it('does not fall back when UPSUN_SYNC_ENV_EXPLICIT=1', () => {
    let failed = false;
    try {
      ensure('feat', {
        MOCK_ACTIVE: '',
        MOCK_STATUS: 'paused',
        MOCK_RESUME_RC: '1',
        UPSUN_SYNC_ENV_EXPLICIT: '1',
      });
    } catch (error) {
      failed = true;
      String(error.stderr || error.message).should.match(/parent fallback is disabled/);
    }
    failed.should.equal(true);
  });
});

describeLinux('upsun_bind_project', () => {
  it('records project:set-remote in the bind-mode mock log', () => {
    const log = path.join(os.tmpdir(), `mock-platform-bind-${process.pid}-${Date.now()}.log`);
    try {
      runHarness(['bind', 'abc123'], {MOCK_PLATFORM_LOG: log});
      fs.readFileSync(log, 'utf8').should.match(/project:set-remote/);
    } finally {
      try {
        fs.unlinkSync(log);
      } catch {
        // ignore
      }
    }
  });
});

describe('pull/push tooling options', () => {
  it('uses the new model-based task APIs and exposes sync flags', () => {
    const pull = getPullTask(model, 'app', cli, [{email: 'dev@example.com', token: 'abc'}]);
    pull.options.project.passthrough.should.equal(true);
    pull.options.env.passthrough.should.equal(true);
    pull.options['no-parent'].passthrough.should.equal(true);
    pull.env.PLATFORM_PROJECT.should.equal('proj123');
    pull.env.UPSUN_CLI_BINARY.should.equal('platform');

    const push = getPushTask(model, 'app', cli, []);
    push.options.env.alias.should.eql(['e']);
    push.options.project.alias.should.eql(['p']);
    push.options.force.boolean.should.equal(true);
  });
});
