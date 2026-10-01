'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const chai = require('chai');
const describeLinux = require('./helpers/describe-linux');
chai.should();

const fixtures = path.join(__dirname, 'fixtures');
const script = path.join(__dirname, '..', 'scripts', 'upsun-tether.sh');
const contexts = [];

const isAlive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitForDead = pid => {
  for (let attempt = 0; attempt < 40 && isAlive(pid); attempt++) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  return !isAlive(pid);
};

const pidFiles = dir => fs.existsSync(dir) ? fs.readdirSync(dir).filter(file => file.endsWith('.pid')) : [];
const readPids = dir => pidFiles(dir).map(file => Number(fs.readFileSync(path.join(dir, file), 'utf8').trim()));

const makeContext = (overrides = {}, options = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-tether-'));
  const tetherDir = path.join(root, 'tether');
  const fpmDir = path.join(root, 'fpm');
  fs.mkdirSync(tetherDir);
  if (options.fpm !== false) fs.mkdirSync(fpmDir);
  const env = {
    ...process.env,
    HOME: root,
    UPSUN_CLI_BINARY: path.join(fixtures, 'mock-upsun-tether.sh'),
    UPSUN_CLI_TOKEN_VAR: 'UPSUN_CLI_TOKEN',
    UPSUN_CLI_TOKEN: 'secret',
    PLATFORM_PROJECT: 'proj',
    PLATFORM_APPLICATION_NAME: 'app',
    PLATFORM_APP_DIR: root,
    UPSUN_TETHER_ENVIRONMENT: 'feature',
    UPSUN_TETHER_DIR: tetherDir,
    UPSUN_TETHER_ENV_FILE: path.join(root, 'tether.env'),
    UPSUN_FPM_POOL_DIR: fpmDir,
    UPSUN_TETHER_WAIT: '0',
    UPSUN_TETHER_BASE_PORT: '30000',
    UPSUN_PGREP: path.join(fixtures, 'mock-pgrep.sh'),
    MOCK_FPM_PID: '',
    MOCK_ACTIVE: 'feature',
    MOCK_TETHER_LOG: path.join(root, 'cli.log'),
    MOCK_RELATIONSHIPS_FILE: path.join(fixtures, 'tether-relationships.json'),
    MOCK_TUNNEL_SLEEP: '30',
    UPSUN_LOG_HELPER: path.join(fixtures, 'log.sh'),
    ...overrides,
  };
  Reflect.deleteProperty(env, 'PLATFORM_RELATIONSHIPS');
  Reflect.deleteProperty(env, 'PLATFORM_APPLICATION');
  Reflect.deleteProperty(env, 'UPSUN_SYNC_NO_PARENT');
  Reflect.deleteProperty(env, 'UPSUN_SYNC_ENV_EXPLICIT');
  const context = {root, tetherDir, fpmDir, env};
  contexts.push(context);
  return context;
};

const run = (context, args = []) => spawnSync('bash', [script, ...args], {
  encoding: 'utf8',
  env: context.env,
});

const sourceEnv = file => {
  const result = spawnSync('bash', ['-c', 'set -a; . "$1"; env -0', 'bash', file], {encoding: 'buffer'});
  result.status.should.equal(0, result.stderr.toString());
  return Object.fromEntries(result.stdout.toString().split('\0').filter(Boolean).map(line => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
};

const cleanup = context => {
  const pids = readPids(context.tetherDir);
  run(context, ['close']);
  for (const pid of pids) {
    if (isAlive(pid)) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  }
  fs.rmSync(context.root, {recursive: true, force: true});
};

const cleanupAll = () => {
  while (contexts.length) {
    cleanup(contexts[0]);
    contexts.shift();
  }
};

describeLinux('Upsun tether script', function() {
  // Several cases wait for real tunnel listeners and UPSUN_TETHER_WAIT timeouts
  this.timeout(20000); // eslint-disable-line no-invalid-this

  afterEach(cleanupAll);

  after(cleanupAll);

  it('opens one tunnel per relationship on sequential ports', () => {
    const context = makeContext();
    const result = run(context);
    result.status.should.equal(0, result.stderr);
    const log = fs.readFileSync(context.env.MOCK_TETHER_LOG, 'utf8');
    log.should.match(/tunnel:single -p proj -e feature -A app -r cache --port 30000 -g/);
    log.should.match(/tunnel:single -p proj -e feature -A app -r database --port 30001 -g/);
    pidFiles(context.tetherDir).should.have.members(['cache.pid', 'database.pid']);
    readPids(context.tetherDir).every(isAlive).should.equal(true);
  });

  it('writes the rewritten relationships and service variables', () => {
    const context = makeContext();
    run(context).status.should.equal(0);
    (fs.statSync(context.env.UPSUN_TETHER_ENV_FILE).mode & 0o777).should.equal(0o644);
    const env = sourceEnv(context.env.UPSUN_TETHER_ENV_FILE);
    env.DATABASE_HOST.should.equal('127.0.0.1');
    env.DATABASE_PORT.should.equal('30001');
    env.DATABASE_URL.should.equal('mysql://main:secret@127.0.0.1:30001/main');
    env.CACHE_URL.should.equal('redis://127.0.0.1:30000');
    env.should.not.have.property('CACHE_USERNAME');
    const relationships = JSON.parse(Buffer.from(env.PLATFORM_RELATIONSHIPS, 'base64'));
    relationships.database[0].should.include({host: '127.0.0.1', ip: '127.0.0.1', port: 30001, username: 'main'});
    fs.readFileSync(path.join(context.tetherDir, 'environment'), 'utf8').trim().should.equal('feature');
  });

  it('fails, closes tunnels and writes no env file when a tunnel never opens', () => {
    const context = makeContext({UPSUN_TETHER_WAIT: '1'});
    const result = run(context, ['open']);
    result.status.should.equal(5, result.stderr);
    result.stderr.should.include('RED Tunnel for cache did not open on port 30000');
    fs.existsSync(context.env.UPSUN_TETHER_ENV_FILE).should.equal(false);
    pidFiles(context.tetherDir).should.eql([]);
    result.stdout.should.not.include('Tethered to');
    const pids = fs.readFileSync(context.env.MOCK_TETHER_LOG, 'utf8').match(/^pid (\d+)$/gm);
    pids.map(line => Number(line.slice(4))).every(waitForDead).should.equal(true);
  });

  it('opens and reports success when the tunnel port listens', () => {
    const context = makeContext({UPSUN_TETHER_WAIT: '3', MOCK_TUNNEL_LISTEN: '1'});
    const result = run(context, ['open']);
    result.status.should.equal(0, result.stderr);
    result.stdout.should.include('GREEN Tethered to feature: 2 relationship(s) tunnelled');
    fs.existsSync(context.env.UPSUN_TETHER_ENV_FILE).should.equal(true);
    pidFiles(context.tetherDir).should.have.members(['cache.pid', 'database.pid']);
    readPids(context.tetherDir).every(isAlive).should.equal(true);
  });

  it('closes earlier listening tunnels when a later tunnel times out', () => {
    const context = makeContext({
      UPSUN_TETHER_WAIT: '3', MOCK_TUNNEL_LISTEN: '1', MOCK_TUNNEL_NO_LISTEN: 'database',
    });
    const result = run(context, ['open']);
    result.status.should.equal(5, result.stderr);
    result.stdout.should.include('Tunnel cache -> 127.0.0.1:30000');
    result.stderr.should.include('RED Tunnel for database did not open on port 30001');
    fs.existsSync(context.env.UPSUN_TETHER_ENV_FILE).should.equal(false);
    fs.existsSync(path.join(context.fpmDir, 'zzz-upsun-tether.conf')).should.equal(false);
    pidFiles(context.tetherDir).should.eql([]);
    result.stdout.should.not.include('Tethered to');
    const pids = fs.readFileSync(context.env.MOCK_TETHER_LOG, 'utf8').match(/^pid (\d+)$/gm);
    pids.should.have.length(2);
    pids.map(line => Number(line.slice(4))).every(waitForDead).should.equal(true);
  });

  it('writes a php-fpm pool env file and reloads php-fpm when present', () => {
    const first = makeContext({MOCK_FPM_PID: '42', UPSUN_KILL: path.join(fixtures, 'mock-kill.sh')});
    first.env.MOCK_KILL_LOG = path.join(first.root, 'kill.log');
    run(first).status.should.equal(0);
    const conf = fs.readFileSync(path.join(first.fpmDir, 'zzz-upsun-tether.conf'), 'utf8');
    conf.should.match(/^\[www\]/);
    // php-fpm's ini parser chokes on unquoted `=` (base64 padding) and `:`/`@` (URLs); values are quoted
    conf.should.include('env[DATABASE_PORT] = "30001"');
    conf.should.match(/^env\[PLATFORM_RELATIONSHIPS\] = "[A-Za-z0-9+/=]+"$/m);
    conf.should.include('env[DATABASE_URL] = "mysql://main:secret@127.0.0.1:30001/main"');
    fs.readFileSync(first.env.MOCK_KILL_LOG, 'utf8').should.include('-USR2 42');

    const second = makeContext({}, {fpm: false});
    run(second).status.should.equal(0);
    fs.existsSync(path.join(second.fpmDir, 'zzz-upsun-tether.conf')).should.equal(false);
  });

  it('falls back to the parent environment like sync does', () => {
    const context = makeContext({MOCK_ACTIVE: 'main', MOCK_PARENT: 'main'});
    const result = run(context);
    result.status.should.equal(0, result.stderr);
    result.stdout.should.include('YELLOW');
    fs.readFileSync(context.env.MOCK_TETHER_LOG, 'utf8').should.match(/ssh -p proj -e main /);
    fs.readFileSync(path.join(context.tetherDir, 'environment'), 'utf8').trim().should.equal('main');
  });

  it('fails clearly when relationships cannot be read', () => {
    const context = makeContext({MOCK_SSH_RC: '1'});
    const result = run(context);
    result.status.should.equal(3);
    result.stderr.should.include('RED Could not read PLATFORM_RELATIONSHIPS');
    fs.existsSync(context.env.UPSUN_TETHER_ENV_FILE).should.equal(false);
  });

  it('close kills tunnels and removes every generated file', () => {
    const context = makeContext();
    run(context).status.should.equal(0);
    const pids = readPids(context.tetherDir);
    const first = run(context, ['close']);
    first.status.should.equal(0, first.stderr);
    first.stdout.should.include('GREEN Tether closed');
    pids.every(waitForDead).should.equal(true);
    pidFiles(context.tetherDir).should.eql([]);
    fs.readdirSync(context.tetherDir).filter(file => file.endsWith('.log')).should.eql([]);
    fs.existsSync(context.env.UPSUN_TETHER_ENV_FILE).should.equal(false);
    fs.existsSync(path.join(context.fpmDir, 'zzz-upsun-tether.conf')).should.equal(false);
    run(context, ['--close']).status.should.equal(0);
  });

  it('info prints the tether state', () => {
    const context = makeContext();
    const before = run(context, ['--info']);
    before.status.should.equal(0);
    before.stdout.should.include('YELLOW Not tethered');
    run(context).status.should.equal(0);
    const after = run(context, ['info']);
    after.stdout.should.include('Environment: feature');
    after.stdout.should.include('database: port 30001 (running)');
    after.stdout.should.include('"database"');
    // credentials are redacted from the informational dump
    after.stdout.should.not.include('secret');
    after.stdout.should.include('"password": "***"');
  });

  it('re-opening replaces existing tunnels', () => {
    const context = makeContext();
    run(context).status.should.equal(0);
    const firstPids = readPids(context.tetherDir);
    run(context, ['open']).status.should.equal(0);
    firstPids.every(waitForDead).should.equal(true);
    const secondPids = readPids(context.tetherDir);
    secondPids.should.have.length(2);
    secondPids.every(isAlive).should.equal(true);
  });

  it('never runs the CLI with PLATFORM_RELATIONSHIPS set', () => {
    const context = makeContext();
    context.env.PLATFORM_RELATIONSHIPS = 'bogus';
    run(context).status.should.equal(0);
    fs.readFileSync(context.env.MOCK_TETHER_LOG, 'utf8').split('\n')[0].should.equal('unset 1');
  });
});
