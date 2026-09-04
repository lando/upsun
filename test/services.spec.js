'use strict';

const chai = require('chai');
chai.should();
const {getLandoServices} = require('../lib/services');

describe('services', () => {
  it('maps Fixed php + mariadb into platformsh-* builders', () => {
    const mapped = getLandoServices([
      {name: 'app', type: 'php:8.0', application: true},
      {name: 'db', type: 'mariadb:10.4', application: false},
    ]);
    mapped.app.type.should.equal('platformsh-php');
    mapped.app.platformsh.application.should.equal(true);
    mapped.app.build_internal.should.eql(['/helpers/upsun-build.sh']);
    mapped.db.type.should.equal('platformsh-mariadb');
  });
});
