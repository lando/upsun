'use strict';

const chai = require('chai');
chai.should();
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync: execFileSyncRaw, spawn: spawnRaw, spawnSync: spawnSyncRaw} = require('child_process');
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
const spawnSync = (file, args, options = {}) => spawnSyncRaw(file, args,
  {...options, timeout: 10000, env: childEnv(options.env)});
const spawn = (file, args, options = {}) => spawnRaw(file, args,
  {...options, timeout: 10000, env: childEnv(options.env)});
const describeLinux = require('./helpers/describe-linux');

const start = path.join(__dirname, '..', 'scripts', 'upsun-start.sh');
const envHelper = path.join(__dirname, '..', 'scripts', 'upsun-env.sh');
const logHelper = path.join(__dirname, 'fixtures', 'log.sh');

describeLinux('Upsun start wrapper', () => {
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

  it('idles when there is no start command', () => {
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

  it('waits for the provisioning marker before pre_start', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-start-'));
    const marker = path.join(appDir, 'provisioned');
    const writer = spawn('bash', ['-c', 'sleep 1; touch "$1"', 'writer', marker], {stdio: 'ignore'});
    try {
      const result = spawnSync('bash', [start], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PLATFORM_APP_DIR: appDir,
          PLATFORM_PRE_APP_COMMAND: 'test -f "$UPSUN_PROVISIONED_FILE" && echo provisioned-pre',
          PLATFORM_APP_COMMAND: 'echo started',
          UPSUN_ENV_HELPER: envHelper,
          UPSUN_LOG_HELPER: logHelper,
          UPSUN_PROVISION_WAIT: '3',
          UPSUN_PROVISIONED_FILE: marker,
        },
      });

      result.stdout.should.include('PINK Waiting for database provisioning...');
      result.status.should.equal(0);
      result.stdout.should.match(/Waiting for database provisioning\.\.\.[\s\S]*provisioned-pre\nstarted\n/);
      result.stdout.split('Waiting for database provisioning...').should.have.length(2);
      result.stdout.should.not.include('YELLOW');
    } finally {
      writer.kill();
      fs.rmSync(appDir, {recursive: true, force: true});
    }
  });

  it('warns and continues when the marker never appears', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-start-'));
    try {
      const result = spawnSync('bash', [start], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PLATFORM_APP_DIR: appDir,
          PLATFORM_PRE_APP_COMMAND: 'echo pre',
          PLATFORM_APP_COMMAND: 'echo started',
          UPSUN_ENV_HELPER: envHelper,
          UPSUN_LOG_HELPER: logHelper,
          UPSUN_PROVISION_WAIT: '1',
          UPSUN_PROVISIONED_FILE: path.join(appDir, 'missing'),
        },
      });

      result.status.should.equal(0);
      result.stdout.should.include('YELLOW Database provisioning not finished after 1s; starting anyway');
      result.stdout.should.match(/starting anyway[\s\S]*pre\nstarted\n/);
    } finally {
      fs.rmSync(appDir, {recursive: true, force: true});
    }
  });

  for (const wait of ['', '0']) {
    it(`does not wait for provisioning when the wait is ${wait || 'unset'}`, () => {
      const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-start-'));
      try {
        const env = {
          ...process.env,
          PLATFORM_APP_DIR: appDir,
          PLATFORM_PRE_APP_COMMAND: 'echo pre',
          PLATFORM_APP_COMMAND: 'echo started',
          UPSUN_ENV_HELPER: envHelper,
          UPSUN_LOG_HELPER: logHelper,
          UPSUN_PROVISION_WAIT: wait,
          UPSUN_PROVISIONED_FILE: path.join(appDir, 'missing'),
        };
        if (!wait) delete env.UPSUN_PROVISION_WAIT;
        const output = execFileSync('bash', [start], {encoding: 'utf8', env});

        output.should.include('pre\nstarted\n');
        output.should.not.include('provisioning');
      } finally {
        fs.rmSync(appDir, {recursive: true, force: true});
      }
    });
  }

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
