'use strict';

const {expect} = require('chai');
const init = require('../inits/upsun');

const lando = {config: {home: '/tmp'}, cache: {get: () => []}};

describe('inits/upsun', () => {
  it('registers upsun and platformsh sources that both resolve to the upsun recipe', () => {
    expect(init.name).to.equal('upsun');
    expect(init.sources.map(source => source.name)).to.deep.equal(['upsun', 'platformsh']);
    for (const source of init.sources) {
      const answers = {};
      source.overrides.recipe.when(answers);
      expect(answers.recipe).to.equal('upsun');
    }
  });

  it('accepts deprecated --platformsh-* flags as aliases', () => {
    const options = init.options(lando);
    expect(options).to.have.all.keys(
      'upsun-auth', 'upsun-auth-token', 'upsun-site', 'platformsh-auth', 'platformsh-site',
    );
    const answers = {'platformsh-site': 'foo', 'platformsh-auth': 'tok'};
    init.overrides.name.when(answers);
    expect(answers.name).to.equal('foo');
    expect(answers['upsun-auth']).to.equal('tok');
  });

  it('clones with the vendor CLI matching the chosen source', () => {
    const flex = init.sources[0].build({'upsun-site': 'foo', 'upsun-auth': 'tok'});
    const fixed = init.sources[1].build({'upsun-site': 'foo', 'upsun-auth': 'tok'});
    const cloneFlex = flex.find(step => step.name === 'clone-repo');
    const cloneFixed = fixed.find(step => step.name === 'clone-repo');
    expect(cloneFlex.image).to.equal('node:20-bookworm');
    expect(cloneFlex.cmd({'upsun-project-id': 'abc'}))
        .to.equal('/helpers/upsun-install-cli.sh upsun && upsun get abc /app');
    expect(cloneFixed.cmd({'upsun-project-id': 'abc'}))
        .to.equal('/helpers/upsun-install-cli.sh platform && platform get abc /app');
    expect(cloneFlex.env({'upsun-auth': ' tok '})).to.include({
      UPSUN_CLI_TOKEN: 'tok',
      UPSUN_CLI_NO_INTERACTION: '1',
      PLATFORM_APPLICATION: '',
      PLATFORM_RELATIONSHIPS: '',
    });
  });
});
