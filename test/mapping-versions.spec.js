'use strict';

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
});
