'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const chai = require('chai');
chai.should();

const {detect} = require('../lib/config/detect');

const fixture = name => path.join(__dirname, 'fixtures', name);

describe('config detection', () => {
  it('detects first-level Flex YAML files in lexical order', () => {
    detect(fixture('flex-config')).should.eql({
      flavor: 'flex',
      layout: 'upsun',
      files: [
        path.join(fixture('flex-config'), '.upsun', 'config.yaml'),
        path.join(fixture('flex-config'), '.upsun', 'extra.yml'),
      ],
    });
  });

  it('detects Fixed configuration while ignoring an empty .upsun directory', () => {
    const result = detect(fixture('fixed-root'));
    result.flavor.should.equal('fixed');
    result.files.should.eql([
      path.join(fixture('fixed-root'), '.platform.app.yaml'),
      path.join(fixture('fixed-root'), '.platform', 'routes.yaml'),
      path.join(fixture('fixed-root'), '.platform', 'services.yaml'),
    ]);
  });

  it('rejects mixed configuration', () => {
    (() => detect(fixture('mixed-config'))).should.throw().with.property('code', 'UPSUN_MIXED_CONFIG');
  });

  it('detects .magento.app.yaml as the fixed flavor with the magento layout', () => {
    detect(fixture('fixed-magento')).should.eql({
      flavor: 'fixed',
      layout: 'magento',
      files: [
        path.join(fixture('fixed-magento'), '.magento.app.yaml'),
        path.join(fixture('fixed-magento'), '.magento', 'routes.yaml'),
        path.join(fixture('fixed-magento'), '.magento', 'services.yaml'),
      ],
    });
  });

  it('reports the platform layout for .platform.app.yaml', () => {
    detect(fixture('fixed-root')).should.include({flavor: 'fixed', layout: 'platform'});
  });

  it('rejects a project mixing .magento and .platform configuration', () => {
    (() => detect(fixture('mixed-magento'))).should.throw().with.property('code', 'UPSUN_MIXED_CONFIG');
  });

  it('rejects Magento services mixed with Flex configuration', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-detect-'));
    try {
      fs.mkdirSync(path.join(root, '.upsun'));
      fs.mkdirSync(path.join(root, '.magento'));
      fs.writeFileSync(path.join(root, '.upsun', 'config.yaml'), 'applications: {}\n');
      fs.writeFileSync(path.join(root, '.magento', 'services.yaml'), 'mysql: {type: "mariadb:10.6"}\n');
      (() => detect(root)).should.throw().with.property('code', 'UPSUN_MIXED_CONFIG');
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('ignores .magento.env.yaml as configuration', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-detect-'));
    try {
      fs.writeFileSync(path.join(root, '.magento.env.yaml'), 'not valid: [');
      (() => detect(root)).should.throw().with.property('code', 'UPSUN_NO_CONFIG');
      fs.writeFileSync(path.join(root, '.platform.app.yaml'), 'name: app\ntype: php:8.3\n');
      detect(root).should.include({flavor: 'fixed', layout: 'platform'});
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('rejects projects without configuration', () => {
    (() => detect(fixture('no-config'))).should.throw().with.property('code', 'UPSUN_NO_CONFIG');
  });

  it('ignores Fixed app files in dependency and metadata directories', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-detect-'));
    try {
      for (const directory of ['node_modules/package', 'vendor/package', '.git/worktree']) {
        const target = path.join(root, directory);
        fs.mkdirSync(target, {recursive: true});
        fs.writeFileSync(path.join(target, '.platform.app.yaml'), 'name: ignored\ntype: php:8.4\n');
      }
      (() => detect(root)).should.throw().with.property('code', 'UPSUN_NO_CONFIG');
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });
});
