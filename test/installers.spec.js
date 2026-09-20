'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync, spawnSync} = require('child_process');
const chai = require('chai');
chai.should();

const fixtures = path.join(__dirname, 'fixtures');
const supercronic = path.join(__dirname, '..', 'scripts', 'upsun-install-supercronic.sh');
const node = path.join(__dirname, '..', 'scripts', 'upsun-install-node.sh');
const roots = [];
const machine = os.arch() === 'arm64' ? {supercronic: 'arm64', node: 'arm64'} : {supercronic: 'amd64', node: 'x64'};

const temporaryRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-installers-'));
  const downloads = path.join(root, 'downloads');
  fs.mkdirSync(downloads);
  roots.push(root);
  return {root, downloads};
};

const run = (script, args, env) => spawnSync('bash', [script, ...args], {
  encoding: 'utf8',
  env: {
    ...process.env,
    UPSUN_LOG_HELPER: path.join(fixtures, 'log.sh'),
    UPSUN_CURL: path.join(fixtures, 'mock-curl.sh'),
    ...env,
  },
});

describe('runtime installers', () => {
  afterEach(() => {
    while (roots.length > 0) fs.rmSync(roots.pop(), {recursive: true, force: true});
  });

  it('installs the pinned supercronic release for the host arch', () => {
    const {root, downloads} = temporaryRoot();
    const installDir = path.join(root, 'bin');
    const curlLog = path.join(root, 'curl.log');
    fs.mkdirSync(installDir);
    fs.writeFileSync(path.join(downloads, `supercronic-linux-${machine.supercronic}`),
      '#!/bin/bash\necho "supercronic-linux v0.2.33"\n', {mode: 0o755});
    const result = run(supercronic, [], {
      UPSUN_INSTALL_DIR: installDir,
      MOCK_CURL_DIR: downloads,
      MOCK_CURL_LOG: curlLog,
    });

    result.status.should.equal(0);
    const installed = path.join(installDir, 'supercronic');
    fs.existsSync(installed).should.equal(true);
    (fs.statSync(installed).mode & 0o777).should.equal(0o755);
    fs.readFileSync(curlLog, 'utf8')
      .should.match(/releases\/download\/v0\.2\.33\/supercronic-linux-(amd64|arm64)$/m);
  });

  it('skips supercronic when the pinned version is present', () => {
    const {root, downloads} = temporaryRoot();
    const installDir = path.join(root, 'bin');
    fs.mkdirSync(installDir);
    fs.writeFileSync(path.join(installDir, 'supercronic'), '#!/bin/bash\necho "supercronic v0.2.33"\n', {mode: 0o755});
    const result = run(supercronic, [], {
      UPSUN_INSTALL_DIR: installDir,
      MOCK_CURL_DIR: downloads,
      MOCK_CURL_LOG: path.join(root, 'curl.log'),
    });

    result.status.should.equal(0);
    result.stdout.should.contain('GREEN supercronic 0.2.33 already installed');
    fs.existsSync(path.join(root, 'curl.log')).should.equal(false);
  });

  it('installs the newest node of the requested major', () => {
    const {root, downloads} = temporaryRoot();
    const prefix = path.join(root, 'prefix');
    const payload = path.join(root, 'node-v22.11.0-linux-x');
    const payloadBin = path.join(payload, 'bin');
    fs.mkdirSync(payloadBin, {recursive: true});
    fs.mkdirSync(prefix);
    fs.writeFileSync(path.join(payloadBin, 'node'), '#!/bin/bash\necho v22.11.0\n', {mode: 0o755});
    fs.writeFileSync(path.join(downloads, 'index.json'),
      '[{"version":"v23.1.0"},{"version":"v22.11.0"},{"version":"v22.10.0"}]\n');
    const tarball = path.join(downloads, `node-v22.11.0-linux-${machine.node}.tar.gz`);
    execFileSync('tar', ['-czf', tarball, '-C', root, path.basename(payload)]);
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
