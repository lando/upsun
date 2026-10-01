'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {createHash} = require('crypto');
const {execFileSync, spawnSync} = require('child_process');
const chai = require('chai');
const describeLinux = require('./helpers/describe-linux');
chai.should();

const fixtures = path.join(__dirname, 'fixtures');
const supercronic = path.join(__dirname, '..', 'scripts', 'upsun-install-supercronic.sh');
const node = path.join(__dirname, '..', 'scripts', 'upsun-install-node.sh');
const cli = path.join(__dirname, '..', 'scripts', 'upsun-install-cli.sh');
const roots = [];

const temporaryRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-installers-'));
  const downloads = path.join(root, 'downloads');
  fs.mkdirSync(downloads);
  const tools = path.join(root, 'tools');
  fs.mkdirSync(tools);
  fs.copyFileSync(path.join(fixtures, 'installers', 'mock-curl.sh'), path.join(tools, 'fake-curl'));
  fs.chmodSync(path.join(tools, 'fake-curl'), 0o755);
  fs.writeFileSync(path.join(tools, 'curl'), '#!/bin/bash\nexit 99\n', {mode: 0o755});
  fs.writeFileSync(path.join(tools, 'uname'), '#!/bin/bash\necho x86_64\n', {mode: 0o755});
  fs.mkdirSync(path.join(root, 'tmp'));
  roots.push(root);
  return {root, downloads};
};

const run = (script, args, env) => spawnSync('bash', [script, ...args], {
  encoding: 'utf8',
  timeout: 10000,
  env: {
    ...process.env,
    BASH_ENV: '',
    UPSUN_SUPERCRONIC_SHA1: undefined,
    UPSUN_LOG_HELPER: path.join(fixtures, 'log.sh'),
    UPSUN_CURL: path.join(path.dirname(env.MOCK_CURL_DIR), 'tools', 'fake-curl'),
    PATH: `${path.join(path.dirname(env.MOCK_CURL_DIR), 'tools')}:${process.env.PATH}`,
    TMPDIR: path.join(path.dirname(env.MOCK_CURL_DIR), 'tmp'),
    ...env,
  },
});

describeLinux('runtime installers', () => {
  afterEach(() => {
    while (roots.length > 0) fs.rmSync(roots.pop(), {recursive: true, force: true});
  });

  for (const binary of ['upsun', 'platform']) {
    for (const checksum of ['matches', 'mismatch', 'missing']) {
      const title = checksum === 'matches' ? `installs ${binary} CLI when the checksum matches` :
        checksum === 'mismatch' ? `refuses a CLI tarball whose sha256 does not match checksums.txt (${binary})` :
          `refuses a CLI tarball missing from checksums.txt (${binary})`;
      it(title, () => {
        const {root, downloads} = temporaryRoot();
        const installDir = path.join(root, 'bin');
        const asset = `${binary}_5.0.0_linux_amd64.tar.gz`;
        fs.writeFileSync(path.join(root, binary), '#!/bin/bash\necho CLI-5.0.0\n', {mode: 0o755});
        execFileSync('tar', ['-czf', path.join(downloads, asset), '-C', root, binary]);
        const digest = createHash('sha256').update(fs.readFileSync(path.join(downloads, asset))).digest('hex');
        fs.writeFileSync(path.join(downloads, 'checksums.txt'),
          `${checksum === 'mismatch' ? '0'.repeat(64) : digest}  ${checksum === 'missing' ? 'other' : asset}\n`);
        const result = run(cli, binary === 'upsun' ? [binary] : [binary, 'v5.0.0'], {
          UPSUN_CLI_INSTALL_DIR: installDir,
          MOCK_CURL_DIR: downloads,
          MOCK_CURL_LOG: path.join(root, 'curl.log'),
        });
        result.status.should.equal(checksum === 'matches' ? 0 : 6, result.stderr);
        fs.existsSync(path.join(installDir, binary)).should.equal(checksum === 'matches');
        if (checksum !== 'matches') {
          result.stderr.should.contain('RED');
          fs.existsSync(installDir).should.equal(false);
        }
        fs.readdirSync(path.join(root, 'tmp')).should.deep.equal([]);
        fs.readFileSync(path.join(root, 'curl.log'), 'utf8').should.contain(
          'https://github.com/upsun/cli/releases/download/v5.0.0/checksums.txt');
      });
    }
  }

  for (const missing of [false, true]) {
    it(missing ? 'refuses a Node.js tarball missing from SHASUMS256.txt' :
      'refuses a Node.js tarball whose sha256 does not match SHASUMS256.txt', () => {
      const {root, downloads} = temporaryRoot();
      const asset = 'node-v22.11.0-linux-x64.tar.gz';
      const prefix = path.join(root, 'prefix');
      fs.mkdirSync(path.join(root, 'payload', 'bin'), {recursive: true});
      fs.writeFileSync(path.join(root, 'payload', 'bin', 'node'), 'untrusted');
      execFileSync('tar', ['-czf', path.join(downloads, asset), '-C', root, 'payload']);
      fs.writeFileSync(path.join(downloads, 'index.json'), '[{"version":"v22.11.0"}]');
      fs.writeFileSync(path.join(downloads, 'SHASUMS256.txt'), `${'0'.repeat(64)}  ${missing ? 'other' : asset}\n`);
      const result = run(node, ['22'], {
        UPSUN_NODE_BIN: 'false', UPSUN_NODE_PREFIX: prefix,
        MOCK_CURL_DIR: downloads, MOCK_CURL_LOG: path.join(root, 'curl.log'),
      });
      result.status.should.equal(6, result.stderr);
      result.stderr.should.contain('RED');
      fs.existsSync(prefix).should.equal(false);
      fs.readdirSync(path.join(root, 'tmp')).should.deep.equal([]);
    });
  }

  for (const arch of ['amd64', 'arm64']) {
    it(`refuses a supercronic binary whose sha1 does not match the pin (${arch})`, () => {
      const {root, downloads} = temporaryRoot();
      const installDir = path.join(root, 'bin');
      fs.writeFileSync(path.join(root, 'tools', 'uname'), `#!/bin/bash\necho ${arch}\n`, {mode: 0o755});
      fs.writeFileSync(path.join(downloads, `supercronic-linux-${arch}`), 'untrusted');
      const result = run(supercronic, [], {
        UPSUN_INSTALL_DIR: installDir,
        MOCK_CURL_DIR: downloads, MOCK_CURL_LOG: path.join(root, 'curl.log'),
      });
      result.status.should.equal(6, result.stderr);
      result.stderr.should.contain('RED');
      fs.existsSync(installDir).should.equal(false);
      result.stderr.should.contain(arch === 'amd64' ?
        'e63c11a9726b775a6a11801e81af4f3fb926aa68' : '0b6c5bb743e0b0dafed1132198c81807927ac413');
      fs.readdirSync(path.join(root, 'tmp')).should.deep.equal([]);
    });
  }

  it('installs supercronic when the checksum matches', () => {
    const {root, downloads} = temporaryRoot();
    const installDir = path.join(root, 'bin');
    const curlLog = path.join(root, 'curl.log');
    fs.mkdirSync(installDir);
    const payload = '#!/bin/bash\necho "supercronic v0.2.49"\n';
    fs.writeFileSync(path.join(downloads, 'supercronic-linux-amd64'), payload);
    const result = run(supercronic, [], {
      UPSUN_INSTALL_DIR: installDir,
      UPSUN_SUPERCRONIC_SHA1: createHash('sha1').update(payload).digest('hex'),
      MOCK_CURL_DIR: downloads,
      MOCK_CURL_LOG: curlLog,
    });

    result.status.should.equal(0);
    const installed = path.join(installDir, 'supercronic');
    fs.existsSync(installed).should.equal(true);
    fs.readFileSync(installed, 'utf8').should.equal(payload);
    (fs.statSync(installed).mode & 0o777).should.equal(0o755);
    fs.readFileSync(curlLog, 'utf8')
      .should.match(/releases\/download\/v0\.2\.49\/supercronic-linux-amd64$/m);
    fs.readdirSync(path.join(root, 'tmp')).should.deep.equal([]);
  });

  it('skips supercronic when the pinned version is present', () => {
    const {root, downloads} = temporaryRoot();
    const installDir = path.join(root, 'bin');
    fs.mkdirSync(installDir);
    fs.writeFileSync(path.join(installDir, 'supercronic'), '#!/bin/bash\necho "supercronic v0.2.49"\n', {mode: 0o755});
    const result = run(supercronic, [], {
      UPSUN_INSTALL_DIR: installDir,
      MOCK_CURL_DIR: downloads,
      MOCK_CURL_LOG: path.join(root, 'curl.log'),
    });

    result.status.should.equal(0);
    result.stdout.should.contain('GREEN supercronic 0.2.49 already installed');
    fs.existsSync(path.join(root, 'curl.log')).should.equal(false);
  });

  it('installs the newest Node.js of the requested major when the checksum matches', () => {
    const {root, downloads} = temporaryRoot();
    const prefix = path.join(root, 'prefix');
    const payload = path.join(root, 'node-v22.11.0-linux-x');
    const payloadBin = path.join(payload, 'bin');
    fs.mkdirSync(payloadBin, {recursive: true});
    fs.mkdirSync(prefix);
    fs.writeFileSync(path.join(payloadBin, 'node'), '#!/bin/bash\necho v22.11.0\n', {mode: 0o755});
    fs.writeFileSync(path.join(downloads, 'index.json'),
      '[{"version":"v23.1.0"},{"version":"v22.11.0"},{"version":"v22.10.0"}]\n');
    const tarball = path.join(downloads, 'node-v22.11.0-linux-x64.tar.gz');
    execFileSync('tar', ['-czf', tarball, '-C', root, path.basename(payload)]);
    const hash = createHash('sha256').update(fs.readFileSync(tarball)).digest('hex');
    fs.writeFileSync(path.join(downloads, 'SHASUMS256.txt'), `${hash}  ${path.basename(tarball)}\n`);
    const result = run(node, ['22'], {
      UPSUN_NODE_PREFIX: prefix,
      UPSUN_NODE_BIN: 'false',
      MOCK_CURL_DIR: downloads,
      MOCK_CURL_LOG: path.join(root, 'curl.log'),
    });

    result.status.should.equal(0);
    fs.existsSync(path.join(prefix, 'bin', 'node')).should.equal(true);
    fs.readFileSync(path.join(root, 'curl.log'), 'utf8')
      .should.match(/\/v22\.11\.0\/node-v22\.11\.0-linux-/);
    fs.readFileSync(path.join(root, 'curl.log'), 'utf8')
      .should.contain('https://nodejs.org/dist/v22.11.0/SHASUMS256.txt');
    fs.readdirSync(path.join(root, 'tmp')).should.deep.equal([]);
  });

  it('skips node when the major already matches', () => {
    const {root, downloads} = temporaryRoot();
    const nodeBin = path.join(root, 'node');
    fs.writeFileSync(nodeBin, '#!/bin/bash\necho v22.9.0\n', {mode: 0o755});
    const result = run(node, ['22'], {
      UPSUN_NODE_PREFIX: path.join(root, 'prefix'),
      UPSUN_NODE_BIN: nodeBin,
      MOCK_CURL_DIR: downloads,
      MOCK_CURL_LOG: path.join(root, 'curl.log'),
    });

    result.status.should.equal(0);
    result.stdout.should.contain('GREEN Node.js 22 already installed');
    fs.existsSync(path.join(root, 'curl.log')).should.equal(false);
  });

  it('fails when the major has no release', () => {
    const {root, downloads} = temporaryRoot();
    fs.mkdirSync(path.join(root, 'prefix'));
    fs.writeFileSync(path.join(downloads, 'index.json'), '[{"version":"v22.11.0"}]\n');
    const result = run(node, ['99'], {
      UPSUN_NODE_PREFIX: path.join(root, 'prefix'),
      UPSUN_NODE_BIN: 'false',
      MOCK_CURL_DIR: downloads,
      MOCK_CURL_LOG: path.join(root, 'curl.log'),
    });

    result.status.should.equal(1);
    result.stderr.should.contain('RED No Node.js 99 release found');
  });
});
