'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync: spawnSyncRaw} = require('child_process');
const childEnv = (overrides = {}) => {
  const env = {...process.env, ...overrides};
  delete env.BASH_ENV;
  delete env.ENV;
  delete env.SHELLOPTS;
  delete env.BASHOPTS;
  return env;
};
const spawnSync = (file, args, options = {}) => spawnSyncRaw(file, args,
  {...options, timeout: 10000, env: childEnv(options.env)});
const chai = require('chai');
const describeLinux = require('./helpers/describe-linux');
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

describeLinux('PHP helper scripts', () => {
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

  it('enables extensions the image ships disabled instead of reinstalling them', () => {
    const root = temporaryRoot();
    const extDir = path.join(root, 'ext');
    fs.mkdirSync(extDir);
    fs.writeFileSync(path.join(extDir, 'xdebug.so'), '');
    const extLog = path.join(root, 'extensions.log');
    const enableLog = path.join(root, 'enable.log');
    const result = run(phpExtensions, ['--enable', 'xdebug,xsl'], {
      UPSUN_PHP_BIN: path.join(fixtures, 'mock-php.sh'),
      UPSUN_PHP_EXT_INSTALLER: path.join(fixtures, 'mock-install-php-extensions.sh'),
      UPSUN_PHP_EXT_ENABLE: path.join(fixtures, 'mock-php-ext-enable.sh'),
      UPSUN_PHP_EXT_DIR: extDir,
      UPSUN_PHP_CONF_DIR: root,
      MOCK_PHP_MODULES: 'Core',
      MOCK_EXT_LOG: extLog,
      MOCK_EXT_ENABLE_LOG: enableLog,
    });

    result.status.should.equal(0);
    fs.readFileSync(enableLog, 'utf8').should.equal('xdebug\n');
    fs.readFileSync(extLog, 'utf8').should.equal('xsl\n');
    result.stdout.should.contain('PINK Enabling PHP extension xdebug');
  });

  it('reports a failed enable and exits 1', () => {
    const root = temporaryRoot();
    const extDir = path.join(root, 'ext');
    fs.mkdirSync(extDir);
    fs.writeFileSync(path.join(extDir, 'xdebug.so'), '');
    const result = run(phpExtensions, ['--enable', 'xdebug'], {
      UPSUN_PHP_BIN: path.join(fixtures, 'mock-php.sh'),
      UPSUN_PHP_EXT_INSTALLER: path.join(fixtures, 'mock-install-php-extensions.sh'),
      UPSUN_PHP_EXT_ENABLE: path.join(fixtures, 'mock-php-ext-enable.sh'),
      UPSUN_PHP_EXT_DIR: extDir,
      UPSUN_PHP_CONF_DIR: root,
      MOCK_PHP_MODULES: 'Core',
      MOCK_EXT_LOG: path.join(root, 'extensions.log'),
      MOCK_EXT_ENABLE_LOG: path.join(root, 'enable.log'),
      MOCK_EXT_ENABLE_FAIL: 'xdebug',
    });

    result.status.should.equal(1);
    result.stderr.should.contain('RED Failed to enable xdebug');
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

  it('xdebug on enables the extension once, writes the mode and reloads php-fpm', () => {
    const root = temporaryRoot();
    const conf = path.join(root, 'conf');
    fs.mkdirSync(conf);
    const killLog = path.join(root, 'kill.log');
    const enableLog = path.join(root, 'enable.log');
    const env = {
      UPSUN_PHP_CONF_DIR: conf,
      UPSUN_PHP_BIN: path.join(fixtures, 'mock-php.sh'),
      UPSUN_PHP_EXT_ENABLE: path.join(fixtures, 'mock-php-ext-enable.sh'),
      UPSUN_PGREP: path.join(fixtures, 'mock-pgrep.sh'),
      UPSUN_KILL: path.join(fixtures, 'mock-kill.sh'),
      MOCK_PHP_MODULES: 'Core',
      MOCK_FPM_PID: '42',
      MOCK_KILL_LOG: killLog,
      MOCK_EXT_ENABLE_LOG: enableLog,
    };
    const result = run(xdebug, ['on', 'debug,profile'], env);

    result.status.should.equal(0);
    fs.readFileSync(path.join(conf, 'zzz-upsun-xdebug.ini'), 'utf8').should.equal('xdebug.mode=debug,profile\n');
    fs.readdirSync(conf).should.deep.equal(['zzz-upsun-xdebug.ini']);
    fs.readFileSync(killLog, 'utf8').should.equal('-USR2 42\n');
    fs.readFileSync(enableLog, 'utf8').should.equal('xdebug\n');

    run(xdebug, ['on'], {...env, MOCK_PHP_MODULES: 'Core\nXdebug'}).status.should.equal(0);
    fs.readFileSync(path.join(conf, 'zzz-upsun-xdebug.ini'), 'utf8').should.equal('xdebug.mode=debug\n');
    fs.readFileSync(enableLog, 'utf8').should.equal('xdebug\n');
  });

  it('xdebug off keeps the extension loaded and sets the mode off', () => {
    const root = temporaryRoot();
    const conf = path.join(root, 'conf');
    fs.mkdirSync(conf);
    fs.writeFileSync(path.join(conf, 'docker-php-ext-xdebug.ini'), 'zend_extension=xdebug\n');
    fs.writeFileSync(path.join(conf, 'zzz-upsun-xdebug.ini'), 'xdebug.mode=debug\n');
    const killLog = path.join(root, 'kill.log');
    const result = run(xdebug, ['off'], {
      UPSUN_PHP_CONF_DIR: conf,
      UPSUN_PHP_BIN: path.join(fixtures, 'mock-php.sh'),
      UPSUN_PGREP: path.join(fixtures, 'mock-pgrep.sh'),
      UPSUN_KILL: path.join(fixtures, 'mock-kill.sh'),
      MOCK_FPM_PID: '42',
      MOCK_KILL_LOG: killLog,
    });

    result.status.should.equal(0);
    fs.readFileSync(path.join(conf, 'zzz-upsun-xdebug.ini'), 'utf8').should.equal('xdebug.mode=off\n');
    fs.existsSync(path.join(conf, 'docker-php-ext-xdebug.ini')).should.equal(true);
    fs.readFileSync(killLog, 'utf8').should.equal('-USR2 42\n');
  });

  it('xdebug off unloads Xdebug 2 because it has no mode setting', () => {
    const root = temporaryRoot();
    const ini = path.join(root, 'docker-php-ext-xdebug.ini');
    const killLog = path.join(root, 'kill.log');
    fs.writeFileSync(ini, 'zend_extension=xdebug\n');
    const result = run(xdebug, ['off'], {
      UPSUN_PHP_CONF_DIR: root,
      UPSUN_PHP_BIN: path.join(fixtures, 'mock-php.sh'),
      UPSUN_PGREP: path.join(fixtures, 'mock-pgrep.sh'),
      UPSUN_KILL: path.join(fixtures, 'mock-kill.sh'),
      MOCK_XDEBUG_VERSION: '2.9.8',
      MOCK_FPM_PID: '42',
      MOCK_KILL_LOG: killLog,
    });

    result.status.should.equal(0);
    fs.existsSync(ini).should.equal(false);
    fs.readFileSync(killLog, 'utf8').should.equal('-USR2 42\n');
  });

  it('xdebug off creates its configuration directory when absent', () => {
    const conf = path.join(temporaryRoot(), 'conf');
    const result = run(xdebug, ['off'], {
      UPSUN_PHP_CONF_DIR: conf,
      UPSUN_PHP_BIN: path.join(fixtures, 'mock-php.sh'),
      UPSUN_PGREP: path.join(fixtures, 'mock-pgrep.sh'),
      MOCK_FPM_PID: '',
    });

    result.status.should.equal(0);
    fs.readFileSync(path.join(conf, 'zzz-upsun-xdebug.ini'), 'utf8').should.equal('xdebug.mode=off\n');
  });

  it('xdebug does not enable or report success when PHP module inspection fails', () => {
    const root = temporaryRoot();
    const enableLog = path.join(root, 'enable.log');
    const result = run(xdebug, ['on'], {
      UPSUN_PHP_CONF_DIR: root,
      UPSUN_PHP_BIN: '/bin/false',
      UPSUN_PHP_EXT_ENABLE: path.join(fixtures, 'mock-php-ext-enable.sh'),
      UPSUN_PGREP: path.join(fixtures, 'mock-pgrep.sh'),
      MOCK_FPM_PID: '',
      MOCK_EXT_ENABLE_LOG: enableLog,
    });

    result.status.should.equal(1);
    fs.existsSync(enableLog).should.equal(false);
    fs.existsSync(path.join(root, 'zzz-upsun-xdebug.ini')).should.equal(false);
    result.stdout.should.not.contain('GREEN Xdebug enabled');
  });

  it('xdebug stops before writing a mode when extension enabling fails', () => {
    const root = temporaryRoot();
    const result = run(xdebug, ['on'], {
      UPSUN_PHP_CONF_DIR: root,
      UPSUN_PHP_BIN: path.join(fixtures, 'mock-php.sh'),
      UPSUN_PHP_EXT_ENABLE: path.join(fixtures, 'mock-php-ext-enable.sh'),
      MOCK_PHP_MODULES: 'Core',
      MOCK_EXT_ENABLE_LOG: path.join(root, 'enable.log'),
      MOCK_EXT_ENABLE_FAIL: 'xdebug',
    });

    result.status.should.equal(1);
    fs.existsSync(path.join(root, 'zzz-upsun-xdebug.ini')).should.equal(false);
    result.stdout.should.not.contain('GREEN Xdebug enabled');
  });

  it('xdebug reports failure rather than success when php-fpm cannot reload', () => {
    for (const action of ['on', 'off']) {
      const root = temporaryRoot();
      const result = run(xdebug, [action], {
        UPSUN_PHP_CONF_DIR: root,
        UPSUN_PHP_BIN: path.join(fixtures, 'mock-php.sh'),
        UPSUN_PGREP: path.join(fixtures, 'mock-pgrep.sh'),
        UPSUN_KILL: '/bin/false',
        MOCK_PHP_MODULES: 'Core\nXdebug',
        MOCK_FPM_PID: '42',
      });

      result.status.should.equal(1);
      result.stdout.should.not.contain('GREEN Xdebug');
    }
  });

  it('xdebug validates the mode and tolerates a stopped php-fpm', () => {
    const root = temporaryRoot();
    const conf = path.join(root, 'conf');
    fs.mkdirSync(conf);
    const env = {
      UPSUN_PHP_CONF_DIR: conf,
      UPSUN_PHP_BIN: path.join(fixtures, 'mock-php.sh'),
      UPSUN_PHP_EXT_ENABLE: path.join(fixtures, 'mock-php-ext-enable.sh'),
      UPSUN_PGREP: path.join(fixtures, 'mock-pgrep.sh'),
      MOCK_PHP_MODULES: 'Core\nXdebug',
      MOCK_FPM_PID: '',
      MOCK_EXT_ENABLE_LOG: path.join(root, 'enable.log'),
    };

    run(xdebug, ['on', 'bad mode'], env).status.should.equal(2);
    const stopped = run(xdebug, ['on'], env);
    stopped.status.should.equal(0);
    stopped.stdout.should.contain('YELLOW php-fpm is not running; settings apply on next start');
  });
});
