'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');
const chai = require('chai');
const should = chai.should();
const flavor = require('../lib/flavor');
const config = require('../lib/config');

const fixture = name => path.join(__dirname, 'fixtures', name);

/**
 * Load app.js. mkdirp is provided by Lando at runtime; stub it for unit tests.
 *
 * @returns {Function} The plugin bootstrap.
 */
const loadAppPlugin = () => {
  try {
    require.resolve('mkdirp');
  } catch {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      if (request === 'mkdirp') {
        return {sync: dir => fs.mkdirSync(dir, {recursive: true})};
      }
      return originalLoad(request, parent, isMain);
    };
  }
  return require('../app');
};

describe('flavor + Fixed config loading', () => {
  it('(a) empty .upsun/ is not Flex and does not throw', () => {
    const dir = fixture('empty-upsun');
    flavor.isFlex(dir).should.equal(false);
    const loaded = config.loadConfigFiles(dir);
    loaded.applications.should.eql([]);
  });

  it('(b) .upsun/config.yaml is Flex; assertFixedOnly throws and config load stays pure', () => {
    const dir = fixture('flex-config');
    flavor.isFlex(dir).should.equal(true);
    (() => flavor.assertFixedOnly(dir)).should.throw(/Found \.upsun\/config\.yaml/);
    try {
      flavor.assertFixedOnly(dir);
      throw new Error('expected Flex abort');
    } catch (err) {
      err.code.should.equal('UPSUN_FLEX_UNSUPPORTED');
    }
    const loaded = config.loadConfigFiles(dir);
    loaded.applications.should.eql([]);
  });

  it('(b2) app.js Flex abort throws and leaves app.platformsh unset', () => {
    const plugin = loadAppPlugin();
    const userConfRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-flex-'));
    const warningsAdded = [];
    const app = {
      root: fixture('flex-config'),
      name: 'flex-abort',
      id: 'flex-abort',
      config: {recipe: 'upsun', config: {}},
      _config: {userConfRoot, domain: 'lndo.site'},
      log: {verbose() {}, debug() {}, silly() {}, alsoSanitize() {}},
      addWarning(warning) {
        warningsAdded.push(warning);
      },
      events: {on() {}},
    };
    const lando = {
      log: {error() {}},
      cache: {get() {}, set() {}, remove() {}},
    };

    let thrown;
    try {
      plugin(app, lando);
    } catch (err) {
      thrown = err;
    }
    should.exist(thrown);
    thrown.code.should.equal('UPSUN_FLEX_UNSUPPORTED');
    thrown.message.should.match(/Found \.upsun\/config\.yaml/);
    thrown.message.should.match(/Flex unsupported until Phase 3/);
    should.not.exist(app.platformsh);
    warningsAdded.should.have.length(1);
    warningsAdded[0].title.should.match(/Flex unsupported until Phase 3/);
  });

  it('(c) Fixed root .platform.app.yaml loads, even with an empty .upsun/', () => {
    const dir = fixture('fixed-root');
    flavor.isFlex(dir).should.equal(false);
    const loaded = config.loadConfigFiles(dir);
    loaded.applications.should.have.length(1);
    loaded.applications[0].name.should.equal('app');
    loaded.applications[0].type.should.equal('php:8.0');
    loaded.services.db.type.should.equal('mariadb:10.4');
    loaded.routes.should.have.property('https://{default}/');
    const apps = config.parseApps(loaded, dir);
    apps[0].webroot.should.equal('/app/web');
  });

  it('(d) Fixed applications.yaml-only multi-app loads both apps', () => {
    const dir = fixture('fixed-applications');
    flavor.isFlex(dir).should.equal(false);
    const loaded = config.loadConfigFiles(dir);
    loaded.applications.should.have.length(2);
    loaded.applications.map(app => app.name).should.eql(['web', 'api']);
    loaded.applicationFiles.should.have.length(2);
    const apps = config.parseApps(loaded, dir);
    apps.should.have.length(2);
    apps.find(app => app.name === 'web').appMountDir.should.equal(path.join(dir, 'web'));
    apps.find(app => app.name === 'api').appMountDir.should.equal(path.join(dir, 'api'));
  });
});
