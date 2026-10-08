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
  it('preserves selection glob characters in a cwd with matching paths', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-parse-'));
    try {
      fs.mkdirSync(path.join(root, 'scripts'));
      const out = execFileSync('bash', [harness, 'parse', '--mount=[s]cripts, tmp,,\tprivate\nfiles'], {
        cwd: root, encoding: 'utf8',
      });
      out.should.match(/^MOUNTS=\[s\]cripts tmp private files$/m);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });
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
  it('uses gzip dumps and app arguments', () => {
    pullSrc.should.match(/(?=[\s\S]*db:dump .*--gzip)(?=[\s\S]*UPSUN_GUNZIP)/);
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
      const out = runHarness(['ensure', branch], {MOCK_PLATFORM_LOG: log, UPSUN_SLEEP: 'true', ...extraEnv});
      const logged = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
      return {out, log: logged};
    } finally {
      fs.rmSync(`${log}.sequence`, {force: true});
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
      try {
        fs.unlinkSync(`${log}.status`);
      } catch {
        // ignore
      }
    }
  }

  it('keeps an already-active branch', () => {
    const {out, log} = ensure('feat', {MOCK_STATUS: 'active'});
    out.should.match(/BRANCH=feat/);
    log.should.not.match(/environment:resume/);
    log.should.not.match(/environment:activate/);
  });

  for (const sequence of ['paused dirty dirty active', 'dirty active']) {
    it(`waits for readiness for ${sequence} without repeating the wake`, () => {
      const {out, log} = ensure('feat', {MOCK_STATUS_SEQUENCE: sequence});
      out.should.include('BRANCH=feat');
      (log.match(/environment:resume/g) || []).should.have.length(sequence.startsWith('paused') ? 1 : 0);
      log.should.not.include('environment:activate');
      log.should.not.match(/ parent/);
      log.match(/ status/g).should.have.length(sequence.split(' ').length);
    });
  }

  for (const status of ['deleting', 'hibernating', 'empty', 'fail-active', 'paused', 'inactive']) {
    it(`hard-stops a retry reporting ${status} without fallback`, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-retry-'));
      const log = path.join(root, 'platform.log');
      try {
        chai.expect(() => runHarness(['ensure', 'feat'], {
          MOCK_PLATFORM_LOG: log, MOCK_STATUS_SEQUENCE: `dirty ${status}`, UPSUN_SLEEP: 'true',
        })).to.throw();
        const calls = fs.readFileSync(log, 'utf8');
        calls.match(/ status/g).should.have.length(2);
        calls.should.not.match(/ parent|environment:resume|environment:activate|db:dump/);
      } finally {
        fs.rmSync(root, {recursive: true, force: true});
      }
    });
  }

  it('bounds dirty retries to twenty 30-second sleeps and prints readable piped progress', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-retry-'));
    const log = path.join(root, 'platform.log');
    const sleep = path.join(root, 'sleep');
    fs.writeFileSync(sleep, '#!/bin/bash\necho "$1" >> "$MOCK_PLATFORM_LOG.sleep"\n', {mode: 0o755});
    try {
      let failure;
      try {
        runHarness(['require', 'feat'], {MOCK_PLATFORM_LOG: log, MOCK_STATUS: 'dirty', UPSUN_SLEEP: sleep});
      } catch (error) {
        failure = error;
      }
      chai.expect(failure).to.have.property('status', 2);
      fs.readFileSync(`${log}.sleep`, 'utf8').trim().split('\n').should.eql(Array(20).fill('30'));
      fs.readFileSync(log, 'utf8').match(/ status/g).should.have.length(21);
      String(failure.stderr).should.include('retrying in 30 seconds');
      String(failure.stderr).should.include('600 seconds');
      String(failure.stderr).should.not.include('\r');
      String(failure.stderr).should.not.include(String.fromCharCode(27));
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('aborts on Ctrl-C during the countdown instead of syncing or falling back', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-retry-'));
    const log = path.join(root, 'platform.log');
    const sleep = path.join(root, 'sleep');
    fs.writeFileSync(sleep, '#!/bin/bash\nkill -INT "$PPID"\n', {mode: 0o755});
    try {
      let failure;
      try {
        runHarness(['ensure', 'feat'], {
          MOCK_PLATFORM_LOG: log, MOCK_STATUS_SEQUENCE: 'dirty active', UPSUN_SLEEP: sleep,
        });
      } catch (error) {
        failure = error;
      }
      chai.expect(failure).to.have.property('status', 130);
      fs.readFileSync(log, 'utf8').match(/ status/g).should.have.length(1);
      fs.readFileSync(log, 'utf8').should.not.match(/ parent|environment:resume|db:dump/);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  // `env -I` only filters `inactive`, so a paused environment is still listed by it.
  // Treating list membership as activeness is what made paused environments fail.
  it('resumes a paused environment that is still listed by env -I', () => {
    const {out, log} = ensure('feat', {MOCK_ACTIVE: 'feat', MOCK_STATUS: 'paused'});
    out.should.match(/BRANCH=feat/);
    out.should.match(/is paused; resuming/);
    log.should.match(/environment:resume/);
  });

  it('resumes a paused environment', () => {
    const {out, log} = ensure('feat', {MOCK_STATUS: 'paused', MOCK_RESUME_RC: '0'});
    out.should.match(/BRANCH=feat/);
    out.should.match(/is paused; resuming/);
    log.should.match(/environment:resume/);
  });

  it('activates an inactive environment', () => {
    const {out, log} = ensure('feat', {MOCK_STATUS: 'inactive', MOCK_ACTIVATE_RC: '0'});
    out.should.match(/BRANCH=feat/);
    out.should.match(/is inactive; activating/);
    log.should.match(/environment:activate/);
  });

  it('refuses a dirty environment instead of falling back to the parent', () => {
    let failed = false;
    try {
      ensure('feat', {MOCK_STATUSES: 'feat=dirty main=active', MOCK_PARENT: 'main'});
    } catch (error) {
      failed = true;
      String(error.stderr || error.message).should.match(/activity in progress/);
    }
    failed.should.equal(true);
  });

  it('refuses a deleting environment instead of falling back to the parent', () => {
    let failed = false;
    try {
      ensure('feat', {MOCK_STATUSES: 'feat=deleting main=active', MOCK_PARENT: 'main'});
    } catch (error) {
      failed = true;
      String(error.stderr || error.message).should.match(/is being deleted/);
    }
    failed.should.equal(true);
  });

  it('refuses an unknown status instead of falling back to the parent', () => {
    let failed = false;
    try {
      ensure('feat', {MOCK_STATUSES: 'feat=hibernating main=active', MOCK_PARENT: 'main'});
    } catch (error) {
      failed = true;
      String(error.stderr || error.message).should.match(/unhandled status 'hibernating'/);
    }
    failed.should.equal(true);
  });

  it('refuses an unreadable status instead of falling back to the parent', () => {
    let failed = false;
    try {
      ensure('feat', {MOCK_STATUS: '', MOCK_PARENT: 'main'});
    } catch (error) {
      failed = true;
      String(error.stderr || error.message).should.match(/Could not read the status/);
    }
    failed.should.equal(true);
  });

  it('refuses when another activity stays dirty for ten minutes after the wake', () => {
    let failed = false;
    try {
      ensure('feat', {MOCK_STATUS: 'paused', MOCK_WAKE_STATUS: 'dirty'});
    } catch (error) {
      failed = true;
      String(error.stderr || error.message).should.match(/activity in progress after 600 seconds/);
    }
    failed.should.equal(true);
  });

  // The wake command can report success and still leave the environment unusable.
  // Only a still-paused/inactive environment may fall back to the parent.
  for (const [status, pattern] of [
    ['deleting', /reports 'deleting' after waking/],
    ['hibernating', /reports 'hibernating' after waking/],
  ]) {
    it(`refuses a '${status || 'unreadable'}' status after the wake instead of falling back`, () => {
      let failed = false;
      try {
        ensure('feat', {MOCK_STATUS: 'paused', MOCK_WAKE_STATUS: status, MOCK_PARENT: 'main'});
      } catch (error) {
        failed = true;
        String(error.stderr || error.message).should.match(pattern);
      }
      failed.should.equal(true);
    });
  }

  it('falls back to parent when resume fails and parent is active', () => {
    const {out, log} = ensure('feat', {
      MOCK_STATUSES: 'feat=paused main=active',
      MOCK_RESUME_RC: '1',
      MOCK_PARENT: 'main',
    });
    out.should.match(/BRANCH=main/);
    log.should.match(/environment:resume/);
  });

  it('hard-fails when resume succeeds but the status never becomes active', () => {
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
