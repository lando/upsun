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

  it('returns http for mercure', () => {
    relationships.defaultEndpoint('mercure').should.equal('http');
  });

  it('returns http for the compose services that had no endpoint', () => {
    relationships.defaultEndpoint('clickhouse').should.equal('http');
    relationships.defaultEndpoint('gotenberg').should.equal('http');
  });

  it('returns the base type endpoint for persistent, replica and enterprise variants', () => {
    for (const [type, endpoint] of [
      ['redis-persistent', 'redis'],
      ['valkey-persistent', 'valkey'],
      ['mariadb-replica', 'mysql'],
      ['postgres-replica', 'postgresql'],
      ['postgresql-replica', 'postgresql'],
      ['mongodb-enterprise', 'mongodb'],
      ['elasticsearch-enterprise', 'elasticsearch'],
    ]) {
      relationships.defaultEndpoint(type).should.equal(endpoint);
    }
  });

  it('never resolves a known service type to a null endpoint', () => {
    // A null endpoint silently exports the string "null" as <REL>_REL, so every mapped type needs one.
    for (const type of ['clickhouse', 'gotenberg', 'redis-persistent', 'valkey-persistent',
      'mariadb-replica', 'postgres-replica', 'postgresql-replica', 'mongodb-enterprise', 'elasticsearch-enterprise']) {
      relationships.parse({rel: {service: type}}, {[type]: {type: {service: type}}})
        .relationships.rel.endpoint.should.be.a('string');
    }
  });
});
