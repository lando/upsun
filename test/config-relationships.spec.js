'use strict';

const chai = require('chai');
chai.should();

const relationships = require('../lib/config/relationships');

describe('config relationships', () => {
  it('does not warn when the target is another application', () => {
    const parsed = relationships.parse({backend: 'app:http', object: {service: 'app'}, app: null}, {},
      {app: {type: 'php:8.3'}});
    parsed.warnings.should.eql([]);
    parsed.relationships.should.eql({backend: {service: 'app', endpoint: 'http'},
      object: {service: 'app', endpoint: 'http'}, app: {service: 'app', endpoint: 'http'}});
  });

  const services = {
    db: {type: {service: 'mariadb', version: '11.4'}},
    redis: {type: {service: 'redis', version: '7.2'}},
    search: {type: {service: 'opensearch', version: '2'}},
  };

  it('normalizes null, object, and legacy string relationship forms', () => {
    relationships.parse({
      redis: null,
      database: 'db:mysql',
      index: {service: 'search', endpoint: 'admin'},
    }, services).should.eql({
      relationships: {
        redis: {service: 'redis', endpoint: 'redis'},
        database: {service: 'db', endpoint: 'mysql'},
        index: {service: 'search', endpoint: 'admin'},
      },
      warnings: [],
    });
  });

  it('keeps unknown services and emits a structured warning', () => {
    relationships.parse({queue: null}, services).should.eql({
      relationships: {queue: {service: 'queue', endpoint: null}},
      warnings: [{
        code: 'relationship-unknown-service',
        message: 'Relationship queue references unknown service queue.',
        data: {relationship: 'queue', service: 'queue'},
      }],
    });
  });

  it('returns the documented default endpoints', () => {
    relationships.defaultEndpoint('mariadb').should.equal('mysql');
    relationships.defaultEndpoint('postgresql').should.equal('postgresql');
    relationships.defaultEndpoint('varnish').should.equal('http');
    relationships.defaultEndpoint('network-storage', 'files').should.equal('files');
  });

  it('returns http for mercure, chroma and qdrant', () => {
    relationships.defaultEndpoint('mercure').should.equal('http');
    relationships.defaultEndpoint('chroma').should.equal('http');
    relationships.defaultEndpoint('qdrant').should.equal('http');
  });
});
