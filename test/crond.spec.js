'use strict';

const chai = require('chai');
chai.should();
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync, spawnSync} = require('child_process');

const crond = path.join(__dirname, '..', 'scripts', 'upsun-crond.sh');
const logHelper = path.join(__dirname, 'fixtures', 'log.sh');
const mockSupercronic = path.join(__dirname, 'fixtures', 'mock-supercronic.sh');
const itUnlessWindows = process.platform === 'win32' ? it.skip : it;

/**
 * Encode an application payload for PLATFORM_APPLICATION.
 *
 * @param {object} application Application payload.
 * @returns {string} Base64-encoded JSON.
 */
function encodeApplication(application) {
  return Buffer.from(JSON.stringify(application)).toString('base64');
}

describe('Upsun cron scheduler', () => {
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

  itUnlessWindows('idles without crons', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-crond-'));
    try {
      const result = spawnSync('timeout', ['2', 'bash', crond], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PLATFORM_APPLICATION: encodeApplication({crons: {}}),
          UPSUN_CRONTAB: path.join(root, 'crontab'),
          UPSUN_SUPERCRONIC: mockSupercronic,
          UPSUN_LOG_HELPER: logHelper,
          MOCK_SUPERCRONIC_LOG: path.join(root, 'supercronic.log'),
        },
      });

      result.status.should.equal(124);
      result.stdout.should.include('No crons defined');
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });
});
