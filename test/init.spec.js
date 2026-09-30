'use strict';

const path = require('path');
const {expect} = require('chai');
const init = require('../inits/upsun');

const lando = {config: {home: '/tmp'}, cache: {get: () => []}};
const fixture = name => path.join(__dirname, 'fixtures', name);

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
    const answers = {'source': 'platformsh', 'platformsh-site': 'foo', 'platformsh-auth': 'tok'};
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
    const flexCmd = cloneFlex.cmd({'upsun-project-id': 'abc', 'upsun-auth': ' tok '});
    const fixedCmd = cloneFixed.cmd({'upsun-project-id': 'abc', 'upsun-auth': ' tok '});
    expect(flexCmd).to.match(/^\/helpers\/upsun-install-cli\.sh upsun && .* upsun get abc \/app$/);
    expect(fixedCmd).to.match(/^\/helpers\/upsun-install-cli\.sh platform && .* platform get abc \/app$/);
    // lando's init runner ignores step.env, so the CLI env must be inlined into the command
    expect(cloneFlex.env).to.equal(undefined);
    for (const pair of ['UPSUN_CLI_TOKEN=tok', 'UPSUN_CLI_NO_INTERACTION=1', 'UPSUN_CLI_UPDATES_CHECK=0',
      'UPSUN_CLI_CONTEXT=1', 'PLATFORM_APPLICATION=', 'PLATFORM_RELATIONSHIPS=']) {
      expect(flexCmd).to.include(` ${pair} `);
    }
    expect(fixedCmd).to.include(' PLATFORMSH_CLI_TOKEN=tok ').and.to.include(' PLATFORMSH_CLI_NO_INTERACTION=1 ');
    expect(fixedCmd).to.not.include('UPSUN_CLI_TOKEN');
  });

  it('derives config.id from the local project file for --source cwd', async () => {
    expect(await init.build({source: 'cwd', destination: fixture('flex-local-project')}, lando))
        .to.deep.equal({config: {id: 'abcdefg123456'}});
    expect(await init.build({source: 'cwd', destination: fixture('flex-drupal')}, lando)).to.deep.equal({});
  });

  it('only prompts for tokens and projects with a remote source', () => {
    const options = init.options(lando);
    const tokenOptions = init.options({cache: {get: () => [{email: 'dev@example.com', token: 'secret'}]}});
    expect(options['upsun-site'].interactive.when({recipe: 'upsun', source: 'cwd'})).to.equal(false);
    expect(options['upsun-site'].interactive.when({recipe: 'upsun', source: 'upsun'})).to.equal(true);
    expect(tokenOptions['upsun-auth'].interactive.when({recipe: 'upsun', source: 'cwd'})).to.equal(false);
    expect(tokenOptions['upsun-auth'].interactive.when({recipe: 'upsun', source: 'upsun'})).to.equal(true);
    expect(options['upsun-auth-token'].interactive.when({recipe: 'upsun', source: 'cwd'})).to.equal(false);
    expect(options['upsun-auth-token'].interactive.when({recipe: 'upsun', source: 'upsun'})).to.equal(true);
  });

  it('keeps the default name prompt for local sources', () => {
    expect(init.overrides.name.when({source: 'cwd'})).to.equal(true);
    expect(init.overrides.name.when({source: 'cwd', name: 'x'})).to.equal(false);
    const remote = {'source': 'upsun', 'upsun-site': 'foo'};
    expect(init.overrides.name.when(remote)).to.equal(false);
    expect(remote.name).to.equal('foo');
  });
});
