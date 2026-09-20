'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const chai = require('chai');
chai.should();

const fixtures = path.join(__dirname, 'fixtures');
const phpExtensions = path.join(__dirname, '..', 'scripts', 'upsun-php-extensions.sh');
const xdebug = path.join(__dirname, '..', 'scripts', 'upsun-xdebug.sh');
const roots = [];

const temporaryRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-php-'));
  roots.push(root);
  return root;
};

const run = (script, args, env) => spawnSync('bash', [script, ...args], {
  encoding: 'utf8',
  env: {...process.env, UPSUN_LOG_HELPER: path.join(fixtures, 'log.sh'), ...env},
});

describe('PHP helper scripts', () => {
  afterEach(() => {
    while (roots.length > 0) fs.rmSync(roots.pop(), {recursive: true, force: true});
  });

  it('installs only extensions that are not already loaded', () => {
    const root = temporaryRoot();
    const extLog = path.join(root, 'extensions.log');
    const result = run(phpExtensions, ['--enable', 'redis,xsl'], {
      UPSUN_PHP_BIN: path.join(fixtures, 'mock-php.sh'),
      UPSUN_PHP_EXT_INSTALLER: path.join(fixtures, 'mock-install-php-extensions.sh'),
      UPSUN_PHP_CONF_DIR: root,
      MOCK_PHP_MODULES: 'Core\nopcache\nredis',
      MOCK_EXT_LOG: extLog,
    });

    result.status.should.equal(0);
    fs.readFileSync(extLog, 'utf8').should.equal('xsl\n');
    result.stdout.should.contain('GREEN redis already enabled');
    result.stdout.should.contain('PINK Installing PHP extension xsl');
  });

  it('disables configured and compiled-in extensions appropriately', () => {
    const root = temporaryRoot();
    const ini = path.join(root, 'docker-php-ext-imap.ini');
    fs.writeFileSync(ini, 'extension=imap.so\n');
    const result = run(phpExtensions, ['--disable', 'imap,opcache'], {
      UPSUN_PHP_BIN: path.join(fixtures, 'mock-php.sh'),
      UPSUN_PHP_EXT_INSTALLER: path.join(fixtures, 'mock-install-php-extensions.sh'),
      UPSUN_PHP_CONF_DIR: root,
      MOCK_PHP_MODULES: 'Core\nopcache',
      MOCK_EXT_LOG: path.join(root, 'extensions.log'),
    });

    result.status.should.equal(0);
    fs.existsSync(ini).should.equal(false);
    result.stdout.should.contain('GREEN Disabled imap');
    result.stdout.should.contain('YELLOW opcache is compiled in and cannot be disabled');
  });

  it('keeps going after a failed install and exits 1', () => {
    const root = temporaryRoot();
    const extLog = path.join(root, 'extensions.log');
    const result = run(phpExtensions, ['--enable', 'xsl,yaml'], {
      UPSUN_PHP_BIN: path.join(fixtures, 'mock-php.sh'),
      UPSUN_PHP_EXT_INSTALLER: path.join(fixtures, 'mock-install-php-extensions.sh'),
      UPSUN_PHP_CONF_DIR: root,
      MOCK_PHP_MODULES: 'Core',
      MOCK_EXT_LOG: extLog,
      MOCK_EXT_FAIL: 'xsl',
    });

    result.status.should.equal(1);
    fs.readFileSync(extLog, 'utf8').should.equal('xsl\nyaml\n');
    result.stderr.should.contain('RED Failed to install xsl');
  });

  it('xdebug on writes config and reloads php-fpm', () => {
    const root = temporaryRoot();
    const conf = path.join(root, 'conf');
    const pool = path.join(root, 'pool');
    fs.mkdirSync(conf);
    fs.mkdirSync(pool);
    const killLog = path.join(root, 'kill.log');
    const enableLog = path.join(root, 'enable.log');
    const result = run(xdebug, ['on', 'debug,profile'], {
      UPSUN_PHP_CONF_DIR: conf,
      UPSUN_FPM_POOL_DIR: pool,
      UPSUN_PHP_EXT_ENABLE: path.join(fixtures, 'mock-php-ext-enable.sh'),
      UPSUN_PGREP: path.join(fixtures, 'mock-pgrep.sh'),
      UPSUN_KILL: path.join(fixtures, 'mock-kill.sh'),
      MOCK_FPM_PID: '42',
      MOCK_KILL_LOG: killLog,
      MOCK_EXT_ENABLE_LOG: enableLog,
    });

    result.status.should.equal(0);
    fs.readFileSync(path.join(conf, 'zzz-upsun-xdebug.ini'), 'utf8')
      .should.equal('xdebug.mode=debug,profile\n');
    fs.readFileSync(path.join(pool, 'zzz-upsun-xdebug.conf'), 'utf8')
      .should.equal('[www]\nenv[XDEBUG_MODE]=debug,profile\n');
    fs.readFileSync(killLog, 'utf8').should.equal('-USR2 42\n');
    fs.readFileSync(enableLog, 'utf8').should.contain('xdebug');
  });

  it('xdebug off removes every generated file', () => {
    const root = temporaryRoot();
    const conf = path.join(root, 'conf');
    const pool = path.join(root, 'pool');
    fs.mkdirSync(conf);
    fs.mkdirSync(pool);
    for (const name of ['zzz-upsun-xdebug.ini', 'docker-php-ext-xdebug.ini']) {
      fs.writeFileSync(path.join(conf, name), 'x\n');
    }
    fs.writeFileSync(path.join(pool, 'zzz-upsun-xdebug.conf'), 'x\n');
    const result = run(xdebug, ['off'], {
      UPSUN_PHP_CONF_DIR: conf,
      UPSUN_FPM_POOL_DIR: pool,
      UPSUN_PGREP: path.join(fixtures, 'mock-pgrep.sh'),
      UPSUN_KILL: path.join(fixtures, 'mock-kill.sh'),
      MOCK_FPM_PID: '',
    });

    result.status.should.equal(0);
    fs.readdirSync(conf).should.deep.equal([]);
    fs.readdirSync(pool).should.deep.equal([]);
  });

  it('xdebug validates the mode and tolerates a stopped php-fpm', () => {
    const root = temporaryRoot();
    const conf = path.join(root, 'conf');
    const pool = path.join(root, 'pool');
    fs.mkdirSync(conf);
    fs.mkdirSync(pool);
    const env = {
      UPSUN_PHP_CONF_DIR: conf,
      UPSUN_FPM_POOL_DIR: pool,
      UPSUN_PHP_EXT_ENABLE: path.join(fixtures, 'mock-php-ext-enable.sh'),
      UPSUN_PGREP: path.join(fixtures, 'mock-pgrep.sh'),
      MOCK_FPM_PID: '',
      MOCK_EXT_ENABLE_LOG: path.join(root, 'enable.log'),
    };

    run(xdebug, ['on', 'bad mode'], env).status.should.equal(2);
    const stopped = run(xdebug, ['on'], env);
    stopped.status.should.equal(0);
    stopped.stdout.should.contain('YELLOW php-fpm is not running; settings apply on next start');
  });
});
