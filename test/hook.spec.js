'use strict';

const chai = require('chai');
chai.should();
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync: execFileSyncRaw, spawnSync: spawnSyncRaw} = require('child_process');
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
const describeLinux = require('./helpers/describe-linux');

const hook = path.join(__dirname, '..', 'scripts', 'upsun-hook.sh');
const envHelper = path.join(__dirname, '..', 'scripts', 'upsun-env.sh');
const logHelper = path.join(__dirname, 'fixtures', 'log.sh');

describeLinux('Upsun hooks', () => {
  for (const [name, script, args, application, extra] of [
    ['hook', hook, ['deploy'], {hooks: {deploy: 'false | true'}}, {}],
    ['cron', path.join(__dirname, '../scripts/upsun-cron.sh'), ['job'],
      {crons: {job: {cmd: 'false | true'}}}, {}],
    ['pre_start', path.join(__dirname, '../scripts/upsun-start.sh'), [], {},
      {PLATFORM_PRE_APP_COMMAND: 'false | true', PLATFORM_APP_COMMAND: 'exit 0'}],
  ]) {
    it(`fails the ${name} body when a non-final pipeline stage fails`, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-pipefail-'));
      try {
        const result = spawnSync('bash', [script, ...args], {encoding: 'utf8', env: {
          ...process.env, PLATFORM_APP_DIR: root, UPSUN_LOG_HELPER: logHelper,
          UPSUN_ENV_HELPER: envHelper,
          PLATFORM_APPLICATION: Buffer.from(JSON.stringify(application)).toString('base64'),
          ...extra,
        }});
        result.status.should.equal(1, result.stderr);
        result.stdout.should.not.include('Finished');
      } finally {
        fs.rmSync(root, {recursive: true, force: true});
      }
    });
  }
  for (const name of ['build', 'deploy']) {
    it(`uses ${name === 'build' ? 'system' : 'vendor'} Composer for the ${name} hook`, () => {
      const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-hook-'));
      try {
        const vendorBin = path.join(appDir, 'vendor', 'bin');
        const appBin = path.join(appDir, 'bin');
        const sysDir = path.join(appDir, 'system');
        for (const dir of [vendorBin, appBin, sysDir]) fs.mkdirSync(dir, {recursive: true});
        fs.writeFileSync(path.join(vendorBin, 'composer'), '#!/bin/bash\nprintf vendor\n', {mode: 0o755});
        fs.writeFileSync(path.join(appBin, 'composer'), '#!/bin/bash\nprintf app\n', {mode: 0o755});
        fs.writeFileSync(path.join(sysDir, 'composer'), '#!/bin/bash\nprintf system\n', {mode: 0o755});
        const application = Buffer.from(JSON.stringify({
          hooks: {[name]: 'composer > result'},
        })).toString('base64');
        execFileSync('bash', [hook, name], {
          env: {
            ...process.env,
            PLATFORM_APPLICATION: application,
            PLATFORM_APP_DIR: appDir,
            PATH: `${vendorBin}:${appBin}:${sysDir}:${process.env.PATH}`,
            BASH_ENV: '',
            UPSUN_LOG_HELPER: logHelper,
          },
        });
        fs.readFileSync(path.join(appDir, 'result'), 'utf8').should.equal(name === 'build' ? 'system' : 'vendor');
      } finally {
        fs.rmSync(appDir, {recursive: true, force: true});
      }
    });
  }

  it('runs the selected hook from PLATFORM_APP_DIR with .environment loaded', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-hook-'));
    fs.writeFileSync(path.join(appDir, '.environment'), 'HOOK_VALUE=loaded\n');
    const application = Buffer.from(JSON.stringify({
      hooks: {deploy: 'printf "%s:%s" "$PWD" "$HOOK_VALUE" > hook-result'},
    })).toString('base64');

    execFileSync('bash', [hook, 'deploy'], {
      env: {...process.env, PLATFORM_APPLICATION: application, PLATFORM_APP_DIR: appDir, UPSUN_LOG_HELPER: logHelper},
    });

    fs.readFileSync(path.join(appDir, 'hook-result'), 'utf8').should.equal(`${appDir}:loaded`);
    fs.rmSync(appDir, {recursive: true});
  });

  it('exposes user connection overrides from .environment to hooks', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-hook-'));
    fs.writeFileSync(path.join(appDir, '.environment'),
      'DATABASE_HOST=127.0.0.1\nDATABASE_PORT=31001\nDATABASE_PASSWORD="manual secret"\n');
    const application = Buffer.from(JSON.stringify({
      hooks: {deploy: 'printf "%s:%s:%s" "$DATABASE_HOST" "$DATABASE_PORT" "$DATABASE_PASSWORD" > hook-result'},
    })).toString('base64');

    execFileSync('bash', [hook, 'deploy'], {
      env: {
        ...process.env, PLATFORM_APPLICATION: application, PLATFORM_APP_DIR: appDir, UPSUN_LOG_HELPER: logHelper,
        UPSUN_ENV_HELPER: envHelper, DATABASE_HOST: 'db', DATABASE_PORT: '3306', DATABASE_PASSWORD: 'generated',
      },
    });

    fs.readFileSync(path.join(appDir, 'hook-result'), 'utf8').should.equal('127.0.0.1:31001:manual secret');
    fs.rmSync(appDir, {recursive: true});
  });

  it('silently skips an absent hook', () => {
    const output = execFileSync('bash', [hook, 'build'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PLATFORM_APPLICATION: Buffer.from('{}').toString('base64'),
        UPSUN_LOG_HELPER: logHelper,
      },
    });
    output.should.equal('');
  });

  it('runs pre_start and post_start from web.commands', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-hook-'));
    const application = Buffer.from(JSON.stringify({
      web: {
        commands: {
          pre_start: 'echo pre > pre.txt',
          post_start: 'echo post > post.txt',
        },
      },
    })).toString('base64');
    try {
      for (const name of ['pre_start', 'post_start']) {
        execFileSync('bash', [hook, name], {
          env: {
            ...process.env,
            PLATFORM_APPLICATION: application,
            PLATFORM_APP_DIR: appDir,
            UPSUN_LOG_HELPER: logHelper,
          },
        });
      }

      fs.readFileSync(path.join(appDir, 'pre.txt'), 'utf8').should.equal('pre\n');
      fs.readFileSync(path.join(appDir, 'post.txt'), 'utf8').should.equal('post\n');
    } finally {
      fs.rmSync(appDir, {recursive: true, force: true});
    }
  });

  it('rejects unknown hook names', () => {
    const result = spawnSync('bash', [hook, 'nope'], {
      encoding: 'utf8',
      env: {...process.env, UPSUN_LOG_HELPER: logHelper},
    });

    result.status.should.equal(2);
  });

  it('sources user .environment connection values in app and CLI contexts', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-env-'));
    try {
      fs.writeFileSync(path.join(appDir, '.environment'), 'DATABASE_HOST=127.0.0.1\n');
      const run = cliContext => execFileSync('bash', [
        '-c',
        '. "$1"; printf "%s" "${DATABASE_HOST:-}"',
        'env-test',
        envHelper,
      ], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PLATFORM_APP_DIR: appDir,
          DATABASE_HOST: 'db',
          UPSUN_CLI_CONTEXT: cliContext,
        },
      });

      run('').should.equal('127.0.0.1');
      run('1').should.equal('127.0.0.1');
    } finally {
      fs.rmSync(appDir, {recursive: true, force: true});
    }
  });
});
