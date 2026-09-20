'use strict';

const chai = require('chai');
chai.should();
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');

const hook = path.join(__dirname, '..', 'scripts', 'upsun-hook.sh');
const logHelper = path.join(__dirname, 'fixtures', 'log.sh');

describe('Upsun hooks', () => {
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
});
