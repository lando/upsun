'use strict';

const chai = require('chai');
chai.should();
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync, spawnSync} = require('child_process');
const describeLinux = require('./helpers/describe-linux');

const hook = path.join(__dirname, '..', 'scripts', 'upsun-hook.sh');
const envHelper = path.join(__dirname, '..', 'scripts', 'upsun-env.sh');
const logHelper = path.join(__dirname, 'fixtures', 'log.sh');

describeLinux('Upsun hooks', () => {
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

  it('exposes the tethered relationships to hooks', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-hook-'));
    const tetherFile = path.join(appDir, 'tether.env');
    fs.writeFileSync(tetherFile, 'DATABASE_HOST=127.0.0.1\n');
    const application = Buffer.from(JSON.stringify({
      hooks: {deploy: 'printf "%s" "$DATABASE_HOST" > hook-result'},
    })).toString('base64');

    execFileSync('bash', [hook, 'deploy'], {
      env: {
        ...process.env, PLATFORM_APPLICATION: application, PLATFORM_APP_DIR: appDir, UPSUN_LOG_HELPER: logHelper,
        UPSUN_ENV_HELPER: envHelper, UPSUN_TETHER_ENV_FILE: tetherFile,
      },
    });

    fs.readFileSync(path.join(appDir, 'hook-result'), 'utf8').should.equal('127.0.0.1');
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

  it('sources the tether env file unless in CLI context', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-env-'));
    const tetherFile = path.join(appDir, 'tether.env');
    try {
      fs.writeFileSync(tetherFile, 'DATABASE_HOST=127.0.0.1\n');
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
          UPSUN_TETHER_ENV_FILE: tetherFile,
          UPSUN_CLI_CONTEXT: cliContext,
        },
      });

      run('').should.equal('127.0.0.1');
      run('1').should.equal('');
    } finally {
      fs.rmSync(appDir, {recursive: true, force: true});
    }
  });

  it('lets .environment override tether values', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-env-'));
    const tetherFile = path.join(appDir, 'tether.env');
    try {
      fs.writeFileSync(tetherFile, 'X=tether\n');
      fs.writeFileSync(path.join(appDir, '.environment'), 'X=app\n');
      const output = execFileSync('bash', [
        '-c',
        '. "$1"; printf "%s" "$X"',
        'env-test',
        envHelper,
      ], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PLATFORM_APP_DIR: appDir,
          UPSUN_TETHER_ENV_FILE: tetherFile,
          UPSUN_CLI_CONTEXT: '',
        },
      });

      output.should.equal('app');
    } finally {
      fs.rmSync(appDir, {recursive: true, force: true});
    }
  });
});
