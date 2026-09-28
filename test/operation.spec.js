'use strict';

const chai = require('chai');
chai.should();
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync, spawnSync} = require('child_process');
const describeLinux = require('./helpers/describe-linux');

const operation = path.join(__dirname, '..', 'scripts', 'upsun-operation.sh');
const logHelper = path.join(__dirname, 'fixtures', 'log.sh');

describeLinux('Upsun operations', () => {
  it('runs the named operation with .environment loaded', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-operation-'));
    const application = Buffer.from(JSON.stringify({
      operations: {
        hello: {commands: {start: 'printf "%s:%s" "$PWD" "$OP_VAL" > op.txt'}},
      },
    })).toString('base64');
    try {
      fs.writeFileSync(path.join(appDir, '.environment'), 'OP_VAL=loaded\n');
      const output = execFileSync('bash', [operation, 'hello'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PLATFORM_APPLICATION: application,
          PLATFORM_APP_DIR: appDir,
          UPSUN_LOG_HELPER: logHelper,
        },
      });

      fs.readFileSync(path.join(appDir, 'op.txt'), 'utf8').should.equal(`${appDir}:loaded`);
      output.should.include('PINK Running operation hello');
      output.should.include('GREEN Finished operation hello');
    } finally {
      fs.rmSync(appDir, {recursive: true, force: true});
    }
  });

  it('fails clearly for unknown or missing names', () => {
    const env = {
      ...process.env,
      PLATFORM_APPLICATION: Buffer.from(JSON.stringify({operations: {}})).toString('base64'),
      UPSUN_LOG_HELPER: logHelper,
    };
    const unknown = spawnSync('bash', [operation, 'nope'], {encoding: 'utf8', env});
    const missing = spawnSync('bash', [operation], {encoding: 'utf8', env});

    unknown.status.should.equal(1);
    unknown.stderr.should.include('No operation named \'nope\'');
    missing.status.should.equal(2);
    missing.stderr.should.include('Usage: lando operation <name>');
  });
});
