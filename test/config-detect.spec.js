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
