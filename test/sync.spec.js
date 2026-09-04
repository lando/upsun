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
 * @param {NodeJS.ProcessEnv} extraEnv Extra env vars.
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
    helperSrc.should.not.match(/UPSUN_CLI_TOKEN/);
    pullSrc.should.match(/export PLATFORMSH_CLI_TOKEN=/);
    pushSrc.should.match(/export PLATFORMSH_CLI_TOKEN=/);
    pullSrc.should.not.match(/UPSUN_CLI_TOKEN/);
    pushSrc.should.not.match(/UPSUN_CLI_TOKEN/);
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
});

describe('upsun_ensure_active_environment', () => {
  /**
   * Run ensure with a fresh mock log.
   *
   * @param {string} branch Environment id.
   * @param {NodeJS.ProcessEnv} extraEnv Mock behavior.
   * @returns {{out: string, log: string}}
   */
  function ensure(branch, extraEnv = {}) {
    const log = path.join(os.tmpdir(), `mock-platform-${process.pid}-${Date.now()}.log`);
    const out = runHarness(['ensure', branch], {MOCK_PLATFORM_LOG: log, ...extraEnv});
    const logged = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    try {
      fs.unlinkSync(log);
    } catch {
      // ignore
    }
    return {out, log: logged};
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

  it('falls back to parent when resume fails', () => {
    const {out, log} = ensure('feat', {
      MOCK_ACTIVE: '',
      MOCK_STATUS: 'paused',
      MOCK_RESUME_RC: '1',
      MOCK_PARENT: 'main',
    });
    out.should.match(/BRANCH=main/);
    log.should.match(/environment:resume/);
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

    const push = getPlatformPush('app', app);
    push.options.project.default.should.equal('proj123');
    push.options.env.alias.should.eql(['e']);
    push.options.project.alias.should.eql(['p']);
  });
});
