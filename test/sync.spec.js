'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');
const chai = require('chai');
chai.should();

const {getPlatformPull} = require('../lib/pull');
const {getPlatformPush} = require('../lib/push');

const harness = path.join(__dirname, 'fixtures', 'sync-harness.sh');
const mockPlatform = path.join(__dirname, 'fixtures', 'mock-platform.sh');
const pullSrc = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'upsun-pull.sh'), 'utf8');
const pushSrc = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'upsun-push.sh'), 'utf8');
const helperSrc = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'upsun-sync-env.sh'), 'utf8');
const builderSrc = fs.readFileSync(path.join(__dirname, '..', 'recipes', 'upsun', 'builder.js'), 'utf8');

const closestApp = {
  syncableRelationships: {database: {}},
  mounts: {'web/sites/default/files': {}},
};

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
      UPSUN_PLATFORM_BIN: mockPlatform,
      ...extraEnv,
    },
  });
}

describe('Fixed pull/push contract', () => {
  it('keeps the platform binary and PLATFORMSH_CLI_TOKEN', () => {
    helperSrc.should.match(/UPSUN_PLATFORM_BIN="\$\{UPSUN_PLATFORM_BIN:-platform\}"/);
    helperSrc.should.match(/PLATFORMSH_CLI_TOKEN/);
    helperSrc.should.not.match(/\$\{?UPSUN_CLI_TOKEN\}?/);
    pullSrc.should.match(/export PLATFORMSH_CLI_TOKEN=/);
    pushSrc.should.match(/export PLATFORMSH_CLI_TOKEN=/);
    pullSrc.should.not.match(/\$\{?UPSUN_CLI_TOKEN\}?/);
    pushSrc.should.not.match(/\$\{?UPSUN_CLI_TOKEN\}?/);
    pullSrc.should.not.match(/(^|[^-\w])upsun auth/);
    pushSrc.should.not.match(/(^|[^-\w])upsun auth/);
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

  it('wires Landofile id into PLATFORM_PROJECT on pull/push', () => {
    builderSrc.should.match(/PLATFORM_PROJECT: projectId/);
    builderSrc.should.match(/_app\.id/);
    builderSrc.should.match(/config\.config\.id/);
    helperSrc.should.match(/project:set-remote/);
    helperSrc.should.match(/-p "\$PLATFORM_PROJECT"/);
  });
});

describe('upsun_parse_sync_args', () => {
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

  it('parses --project, --env, and --no-parent', () => {
    const out = runHarness(['parse', '--project', 'abc123', '--env', 'feat', '--no-parent']);
    out.should.match(/PROJECT=abc123/);
    out.should.match(/BRANCH=feat/);
    out.should.match(/NO_PARENT=1/);
    out.should.match(/ENV_EXPLICIT=1/);
  });

  it('parses --auth space-form and equals-form', () => {
    runHarness(['parse', '--auth', 'tok-space']).should.match(/AUTH=tok-space/);
    runHarness(['parse', '--auth=tok-eq']).should.match(/AUTH=tok-eq/);
  });

  it('leaves relationships and mounts empty when -r / -m are omitted', () => {
    const out = runHarness(['parse']);
    out.should.match(/^RELS=$/m);
    out.should.match(/^MOUNTS=$/m);
  });

  it('parses literal none for -r / -m (skip is applied later)', () => {
    const out = runHarness(['parse', '-r', 'none', '-m', 'none']);
    out.should.match(/RELS=none/);
    out.should.match(/MOUNTS=none/);
  });

  it('skips empty -r / -m values', () => {
    const out = runHarness(['parse', '-r', '', '-m', '']);
    out.should.match(/^RELS=$/m);
    out.should.match(/^MOUNTS=$/m);
  });

  it('splits comma-separated -r / -m values', () => {
    const out = runHarness(['parse', '-r', 'database,migrate', '-m', 'tmp,private']);
    out.should.match(/RELS=database migrate/);
    out.should.match(/MOUNTS=tmp private/);
  });

  it('parses -e / -p short forms and --environment alias', () => {
    const out = runHarness(['parse', '-p', 'proj9', '-e', 'feat', '--environment', 'other']);
    out.should.match(/PROJECT=proj9/);
    out.should.match(/BRANCH=other/);
    out.should.match(/ENV_EXPLICIT=1/);
  });

  it('ignores unknown flags and leftover positionals', () => {
    const out = runHarness(['parse', 'positional', '-r', 'database', '--wat', 'nope', '-m', 'tmp']);
    out.should.match(/RELS=database/);
    out.should.match(/MOUNTS=tmp/);
  });

  it('stops parsing after --', () => {
    const out = runHarness(['parse', '-r', 'database', '--', '--mount=tmp']);
    out.should.match(/RELS=database/);
    out.should.match(/^MOUNTS=$/m);
  });
});

describe('empty / none -r / -m skip', () => {
  it('treats omitted -r / -m as warn-list (no auto-primary)', () => {
    const out = runHarness(['skip-none']);
    out.should.match(/RELS_COUNT=0/);
    out.should.match(/MOUNTS_COUNT=0/);
    out.should.match(/RELS_ACTION=warn-list/);
    out.should.match(/MOUNTS_ACTION=warn-list/);
  });

  it('treats -r none / -m none as warn-list skip', () => {
    const out = runHarness(['skip-none', '-r', 'none', '-m', 'none']);
    out.should.match(/RELS_COUNT=0/);
    out.should.match(/MOUNTS_COUNT=0/);
    out.should.match(/RELS_ACTION=warn-list/);
    out.should.match(/MOUNTS_ACTION=warn-list/);
  });

  it('keeps a real -r / -m as sync', () => {
    const out = runHarness(['skip-none', '-r', 'database', '-m', 'web/sites/default/files']);
    out.should.match(/RELS=database/);
    out.should.match(/MOUNTS=web\/sites\/default\/files/);
    out.should.match(/RELS_ACTION=sync/);
    out.should.match(/MOUNTS_ACTION=sync/);
  });

  it('unsets the whole list when none is mixed with other values', () => {
    const out = runHarness(['skip-none', '-r', 'database', '-r', 'none', '-m', 'tmp', '-m', 'none']);
    out.should.match(/RELS_ACTION=warn-list/);
    out.should.match(/MOUNTS_ACTION=warn-list/);
  });

  it('pull/push scripts skip none and warn+list when empty (no auto-primary)', () => {
    pullSrc.should.match(/if \[ "\$PLATFORM_RELATIONSHIP" == 'none' \]/);
    pullSrc.should.match(/Looks like you did not pass in any relationships!/);
    pullSrc.should.match(/upsun_platform relationships --refresh \|\| true/);
    pullSrc.should.match(/Looks like you did not pass in any mounts!/);
    pullSrc.should.match(/upsun_platform mounts --refresh \|\| true/);
    pushSrc.should.match(/if \[ "\$PLATFORM_RELATIONSHIP" == 'none' \]/);
    pushSrc.should.match(/Looks like you did not pass in any relationships!/);
    pushSrc.should.match(/upsun_platform relationships --refresh \|\| true/);
  });
});

describe('upsun_ensure_active_environment', () => {
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

describe('upsun_bind_project', () => {
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
  const app = {
    id: 'proj123',
    meta: {email: 'dev@example.com', token: 'abc'},
    platformsh: {closestApp, tokens: []},
  };

  it('defaults --project to Landofile id and exposes --env', () => {
    const pull = getPlatformPull('app', app);
    pull.options.project.default.should.equal('proj123');
    pull.options.project.passthrough.should.equal(true);
    pull.options.env.passthrough.should.equal(true);
    pull.options['no-parent'].passthrough.should.equal(true);
    pull.options.auth.describe.should.match(/PLATFORMSH_CLI_TOKEN/);
    pull.options.relationship.description.should.match(/none/);
    pull.options.mount.description.should.match(/none/);

    const push = getPlatformPush('app', app);
    push.options.project.default.should.equal('proj123');
    push.options.env.alias.should.eql(['e']);
    push.options.project.alias.should.eql(['p']);
  });
});
