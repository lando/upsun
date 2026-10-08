'use strict';

const chai = require('chai');
chai.should();
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync: execFileSyncRaw, spawn: spawnRaw} = require('child_process');
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
const spawn = (file, args, options = {}) => spawnRaw(file, args,
  {...options, timeout: 10000, env: childEnv(options.env)});
const describeLinux = require('./helpers/describe-linux');

const crond = path.join(__dirname, '..', 'scripts', 'upsun-crond.sh');
const logHelper = path.join(__dirname, 'fixtures', 'log.sh');
const mockSupercronic = path.join(__dirname, 'fixtures', 'mock-supercronic.sh');

/**
 * Encode an application payload for PLATFORM_APPLICATION.
 *
 * @param {object} application Application payload.
 * @returns {string} Base64-encoded JSON.
 */
function encodeApplication(application) {
  return Buffer.from(JSON.stringify(application)).toString('base64');
}

describeLinux('Upsun cron scheduler', () => {
  it('renders a supercronic crontab from PLATFORM_APPLICATION', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-crond-'));
    const crontab = path.join(root, 'crontab');
    const log = path.join(root, 'supercronic.log');
    try {
      execFileSync('bash', [crond], {
        env: {
          ...process.env,
          PLATFORM_APPLICATION: encodeApplication({
            crons: {
              tick: {spec: '* * * * *', commands: {start: 'date'}},
              nightly: {spec: '0 2 * * *', commands: {start: 'x'}},
            },
          }),
          UPSUN_CRONTAB: crontab,
          UPSUN_SUPERCRONIC: mockSupercronic,
          UPSUN_LOG_HELPER: logHelper,
          MOCK_SUPERCRONIC_LOG: log,
        },
      });

      const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
      lines.slice(0, 2).should.eql(['-passthrough-logs', crontab]);
      lines.slice(2).sort().should.eql([
        '* * * * * /helpers/upsun-cron.sh tick',
        '0 2 * * * /helpers/upsun-cron.sh nightly',
      ].sort());
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('skips crons without a spec', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-crond-'));
    const crontab = path.join(root, 'crontab');
    const log = path.join(root, 'supercronic.log');
    try {
      const output = execFileSync('bash', [crond], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PLATFORM_APPLICATION: encodeApplication({
            crons: {
              tick: {spec: '* * * * *', commands: {start: 'date'}},
              broken: {commands: {start: 'x'}},
            },
          }),
          UPSUN_CRONTAB: crontab,
          UPSUN_SUPERCRONIC: mockSupercronic,
          UPSUN_LOG_HELPER: logHelper,
          MOCK_SUPERCRONIC_LOG: log,
        },
      });

      fs.readFileSync(crontab, 'utf8').trim().split('\n').should.eql([
        '* * * * * /helpers/upsun-cron.sh tick',
      ]);
      output.should.include('YELLOW');
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('idles without crons', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-crond-'));
    let child;
    try {
      child = spawn('bash', [crond], {
        env: {
          ...process.env,
          PLATFORM_APPLICATION: encodeApplication({crons: {}}),
          UPSUN_CRONTAB: path.join(root, 'crontab'),
          UPSUN_SUPERCRONIC: mockSupercronic,
          UPSUN_LOG_HELPER: logHelper,
          MOCK_SUPERCRONIC_LOG: path.join(root, 'supercronic.log'),
        },
      });

      await new Promise((resolve, reject) => {
        let output = '';
        child.on('error', reject);
        child.on('exit', code => reject(new Error(`Cron scheduler exited before readiness: ${code}`)));
        child.stdout.on('data', data => {
          output += data.toString();
          if (output.includes('No crons defined')) resolve();
        });
      });
      chai.expect(child.exitCode).to.equal(null);
      process.kill(child.pid, 0);
    } finally {
      if (child && child.exitCode === null) {
        const exited = new Promise(resolve => child.once('close', resolve));
        child.kill();
        await exited;
      }
      fs.rmSync(root, {recursive: true, force: true});
    }
  });
});
