'use strict';

const path = require('path');
const fs = require('fs');
const chai = require('chai');
chai.should();
const flavor = require('../lib/flavor');
const config = require('../lib/config');

const fixture = name => path.join(__dirname, 'fixtures', name);

describe('flavor + Fixed config loading', () => {
  it('(a) empty .upsun/ is not Flex and does not throw', () => {
    const dir = fixture('empty-upsun');
    flavor.isFlex(dir).should.equal(false);
    const loaded = config.loadConfigFiles(dir);
    loaded.applications.should.eql([]);
  });

  it('(b) .upsun/config.yaml is Flex; abort is warnings + log.error, not loadConfigFiles throw', () => {
    const dir = fixture('flex-config');
    flavor.isFlex(dir).should.equal(true);
    (() => flavor.assertFixedOnly(dir)).should.throw(/Found \.upsun\/config\.yaml/);
    // Config load stays pure; app.js uses the empty-app abort path.
    const loaded = config.loadConfigFiles(dir);
    loaded.applications.should.eql([]);
    const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    appJs.should.match(/warnings\.flexUnsupported\(\)/);
    appJs.should.match(/lando\.log\.error\(flavor\.FLEX_MESSAGE\)/);
    appJs.should.match(/Upsun Fixed \(\.platform\) applications/);
    appJs.should.not.match(/supported Platform\.sh applications/);
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
