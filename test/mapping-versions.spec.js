'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const chai = require('chai');
chai.should();
const {resolveVersion, VERSION_TABLES} = require('../lib/mapping/versions');

describe('mapping versions', () => {
  it('resolves exact and semantically exact versions without warnings', () => {
    resolveVersion('php', '8.4').should.eql({version: '8.4'});
    resolveVersion('postgres', '10.6').should.eql({version: '10.6.0'});
    resolveVersion('elasticsearch', '8.4').should.eql({version: '8.4.x'});
    resolveVersion('redis', '8.00').should.eql({version: '8.0'});
    resolveVersion('php', '8').should.eql({version: '8.0'});
    resolveVersion('memcached', '1.6').should.eql({version: '1.6'});
  });

  it('selects the nearest lower minor in the requested major', () => {
    const resolved = resolveVersion('php', '8.6');
    resolved.version.should.equal('8.5');
    resolved.warning.code.should.equal('version-fallback');
    resolved.warning.data.should.eql({landoType: 'php', wanted: '8.6', resolved: '8.5'});
    resolveVersion('redis', '8.1').version.should.equal('8.0');
  });

  it('selects the newest supported version when the major is unavailable', () => {
    const resolved = resolveVersion('php', '9.1');
    resolved.version.should.equal('8.5');
    resolved.warning.code.should.equal('version-unsupported');
  });

  it('includes supported and legacy versions from every bundled plugin', () => {
    Object.keys(VERSION_TABLES).should.have.members([
      'php', 'node', 'python', 'ruby', 'go', 'mariadb', 'mysql', 'postgres', 'redis',
      'memcached', 'mongo', 'solr', 'elasticsearch', 'varnish',
    ]);
    VERSION_TABLES.go.should.include('1.22');
    VERSION_TABLES.php.should.include('5.3');
  });

  it('rejects unknown Lando plugin types', () => {
    (() => resolveVersion('java', '21')).should.throw('Unknown Lando service type: java');
  });

  it('prefers a supplied supported list', () => {
    resolveVersion('php', '8.4', ['8.3', '8.2']).should.include({version: '8.3'});
    resolveVersion('php', '8.4', ['8.3', '8.2']).warning.code.should.equal('version-fallback');
    resolveVersion('php', '8.4', ['8.4']).should.eql({version: '8.4'});
    resolveVersion('java', '21', ['21']).should.eql({version: '21'});
  });

  it('regenerates from LANDO_PLUGINS_DIR', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-versions-'));
    const plugin = path.join(temporary, 'php', 'builders');
    const output = path.join(temporary, 'versions.js');
    fs.mkdirSync(plugin, {recursive: true});
    fs.writeFileSync(path.join(plugin, 'php.js'), `module.exports = {config: {supported: ['9.9']}};\n`);

    const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'update-versions.js')], {
      encoding: 'utf8',
      env: {...process.env, LANDO_PLUGINS_DIR: temporary, UPSUN_VERSIONS_OUTPUT: output},
    });
    result.status.should.equal(0, result.stderr);
    const generated = fs.readFileSync(output, 'utf8');
    generated.should.include(`'9.9'`);
    generated.should.include('resolveVersion = (landoType, wanted, supported)');
    fs.rmSync(temporary, {recursive: true, force: true});
  });
});
