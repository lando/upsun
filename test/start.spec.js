'use strict';

const chai = require('chai');
chai.should();
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync, spawn, spawnSync} = require('child_process');

const start = path.join(__dirname, '..', 'scripts', 'upsun-start.sh');
const envHelper = path.join(__dirname, '..', 'scripts', 'upsun-env.sh');
const logHelper = path.join(__dirname, 'fixtures', 'log.sh');
const itUnlessWindows = process.platform === 'win32' ? it.skip : it;

describe('Upsun start wrapper', () => {
  it('runs pre_start then execs the app command from the app dir', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-start-'));
    try {
      const output = execFileSync('bash', [start], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PLATFORM_APP_DIR: appDir,
          PLATFORM_PRE_APP_COMMAND: 'echo pre > pre.txt',
          PLATFORM_APP_COMMAND: 'printf "%s" "$PWD" > start.txt',
          UPSUN_ENV_HELPER: envHelper,
          UPSUN_LOG_HELPER: logHelper,
        },
      });

      fs.readFileSync(path.join(appDir, 'pre.txt'), 'utf8').should.equal('pre\n');
      fs.readFileSync(path.join(appDir, 'start.txt'), 'utf8').should.equal(appDir);
      output.should.include('PINK Running pre_start');
    } finally {
      fs.rmSync(appDir, {recursive: true, force: true});
    }
  });

  itUnlessWindows('idles when there is no start command', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-start-'));
    try {
      const result = spawnSync('timeout', ['2', 'bash', start], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PLATFORM_APP_DIR: appDir,
          PLATFORM_PRE_APP_COMMAND: '',
          PLATFORM_APP_COMMAND: '',
          UPSUN_ENV_HELPER: envHelper,
          UPSUN_LOG_HELPER: logHelper,
        },
      });

      result.status.should.equal(124);
    } finally {
      fs.rmSync(appDir, {recursive: true, force: true});
    }
  });

  it('propagates a failing pre_start', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-start-'));
    try {
      const result = spawnSync('bash', [start], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PLATFORM_APP_DIR: appDir,
          PLATFORM_PRE_APP_COMMAND: 'exit 7',
          PLATFORM_APP_COMMAND: 'true',
          UPSUN_ENV_HELPER: envHelper,
          UPSUN_LOG_HELPER: logHelper,
        },
      });

      result.status.should.equal(7);
      result.stderr.should.include('RED');
    } finally {
      fs.rmSync(appDir, {recursive: true, force: true});
    }
  });

  it('waits for the tether env file when tethered', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-start-'));
    const tetherFile = path.join(appDir, 'tether.env');
    const writer = spawn('bash', [
      '-c',
      'sleep 1; printf "DATABASE_HOST=127.0.0.1\\n" > "$1"',
      'writer',
      tetherFile,
    ], {stdio: 'ignore'});
    try {
      const output = execFileSync('bash', [start], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PLATFORM_APP_DIR: appDir,
          PLATFORM_PRE_APP_COMMAND: '',
          PLATFORM_APP_COMMAND: 'echo "$DATABASE_HOST" > host.txt',
          UPSUN_ENV_HELPER: envHelper,
          UPSUN_LOG_HELPER: logHelper,
          UPSUN_TETHERED: '1',
          UPSUN_TETHER_ENV_FILE: tetherFile,
          UPSUN_TETHER_TIMEOUT: '5',
        },
      });

      fs.readFileSync(path.join(appDir, 'host.txt'), 'utf8').should.equal('127.0.0.1\n');
      output.should.include('Waiting for the Upsun tether');
    } finally {
      writer.kill();
      fs.rmSync(appDir, {recursive: true, force: true});
    }
  });

  it('continues with a warning when the tether never appears', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-start-'));
    try {
      const result = spawnSync('bash', [start], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PLATFORM_APP_DIR: appDir,
          PLATFORM_PRE_APP_COMMAND: '',
          PLATFORM_APP_COMMAND: 'true',
          UPSUN_ENV_HELPER: envHelper,
          UPSUN_LOG_HELPER: logHelper,
          UPSUN_TETHERED: '1',
          UPSUN_TETHER_ENV_FILE: path.join(appDir, 'missing.env'),
          UPSUN_TETHER_TIMEOUT: '1',
        },
      });

      result.status.should.equal(0);
      result.stdout.should.include('YELLOW Tether not ready');
    } finally {
      fs.rmSync(appDir, {recursive: true, force: true});
    }
  });

  it('sources the app .environment before the app command', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-start-'));
    try {
      fs.writeFileSync(path.join(appDir, '.environment'), 'FROM_ENV=yes\n');
      execFileSync('bash', [start], {
        env: {
          ...process.env,
          PLATFORM_APP_DIR: appDir,
          PLATFORM_PRE_APP_COMMAND: '',
          PLATFORM_APP_COMMAND: 'echo "$FROM_ENV" > env.txt',
          UPSUN_ENV_HELPER: envHelper,
          UPSUN_LOG_HELPER: logHelper,
        },
      });

      fs.readFileSync(path.join(appDir, 'env.txt'), 'utf8').should.equal('yes\n');
    } finally {
      fs.rmSync(appDir, {recursive: true, force: true});
    }
  });
});
