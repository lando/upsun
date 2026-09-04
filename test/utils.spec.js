'use strict';

const chai = require('chai');
chai.should();
const utils = require('../lib/utils');

describe('utils', () => {
  it('treats upsun and platformsh as the same recipe', () => {
    utils.isUpsunRecipe('upsun').should.equal(true);
    utils.isUpsunRecipe('platformsh').should.equal(true);
    utils.isUpsunRecipe('lamp').should.equal(false);
  });

  it('prefixes appserver commands with the exec wrapper', () => {
    const cmds = utils.setPshExec(['php -v'], 'app', ['app']);
    cmds[0].app.should.equal('/helpers/upsun-exec.sh php -v');
  });

  it('filters application vs service containers via platformsh metadata', () => {
    const services = [
      {name: 'app', platformsh: {application: true}},
      {name: 'db', platformsh: {application: false}},
      {name: 'other', platformsh: {}},
    ];
    utils.getApplicationServices(services).map(s => s.name).should.eql(['app']);
    utils.getNonApplicationServices(services).map(s => s.name).should.eql(['db']);
  });
});
