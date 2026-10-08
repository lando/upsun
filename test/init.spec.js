'use strict';

const path = require('path');
const {execFileSync} = require('child_process');
const {expect} = require('chai');
const init = require('../inits/upsun');
const login = require('../lib/login');

const lando = {config: {home: '/tmp'}, cache: {get: () => []}};
const fixture = name => path.join(__dirname, 'fixtures', name);

describe('inits/upsun', () => {
  const originalLogin = login.promptBrowserLogin;
  afterEach(() => login.promptBrowserLogin = originalLogin);
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
      'upsun-auth', 'upsun-auth-browser', 'upsun-auth-token', 'upsun-site', 'platformsh-auth', 'platformsh-site',
    );
    const answers = {'source': 'platformsh', 'platformsh-site': 'foo', 'platformsh-auth': 'tok'};
    init.overrides.name.when(answers);
    expect(answers.name).to.equal('foo');
    expect(answers['upsun-auth']).to.equal('tok');
  });

  it('clones with the vendor CLI matching the chosen source', () => {
    const destination = fixture('no-config');
    const flex = init.sources[0].build({'upsun-site': 'foo', 'upsun-auth': 'tok', destination});
    const fixed = init.sources[1].build({'upsun-site': 'foo', 'upsun-auth': 'tok', destination});
    const cloneFlex = flex.find(step => step.name === 'clone-repo');
    const cloneFixed = fixed.find(step => step.name === 'clone-repo');
    const flexCmd = cloneFlex.cmd({'upsun-project-id': 'abc', 'upsun-auth': ' tok '});
    const fixedCmd = cloneFixed.cmd({'upsun-project-id': 'abc', 'upsun-auth': ' tok '});
    // /app always exists (it is the bind mount) and `get` refuses an existing directory, so clone beside it
    const tail = ' get \'abc\' /tmp/upsun-get && cp -rfT /tmp/upsun-get /app';
    expect(flexCmd.startsWith('{ test ! -e /app/.git || { echo ')).to.equal(true);
    expect(flexCmd).to.include(' exit 1; }; } && /helpers/upsun-install-cli.sh upsun && rm -rf /tmp/upsun-get && ');
    expect(fixedCmd).to.include(' && /helpers/upsun-install-cli.sh platform && rm -rf /tmp/upsun-get && ');
    expect(flexCmd.endsWith(` upsun${tail}`)).to.equal(true);
    expect(fixedCmd.endsWith(` platform${tail}`)).to.equal(true);
    // lando's init runner ignores step.env, so the CLI env must be inlined into the command
    expect(cloneFlex.env).to.equal(undefined);
    for (const pair of ['UPSUN_CLI_TOKEN=\'tok\'', 'UPSUN_CLI_NO_INTERACTION=\'1\'', 'UPSUN_CLI_UPDATES_CHECK=\'0\'',
      'UPSUN_CLI_CONTEXT=\'1\'', 'PLATFORM_APPLICATION=\'\'', 'PLATFORM_RELATIONSHIPS=\'\'']) {
      expect(flexCmd).to.include(` ${pair} `);
    }
    expect(fixedCmd).to.include(' PLATFORMSH_CLI_TOKEN=\'tok\' ')
        .and.to.include(' PLATFORMSH_CLI_NO_INTERACTION=\'1\' ');
    expect(fixedCmd).to.not.include('UPSUN_CLI_TOKEN');
  });

  it('preserves shell metacharacters in clone tokens and project IDs', () => {
    const token = 'token\' $HOME spaces; echo injected';
    const projectId = 'project\' $HOME spaces; echo injected';
    const clone = init.sources[0].build({destination: fixture('no-config')})
        .find(step => step.name === 'clone-repo');

    const command = clone.cmd({'upsun-auth': token, 'upsun-project-id': projectId});

    const prefix = command.split(' && ')[3].split(' upsun get ')[0];
    expect(execFileSync('bash', ['-c', `${prefix} printenv UPSUN_CLI_TOKEN`], {encoding: 'utf8'}))
        .to.equal(`${token}\n`);
    const args = command.split(' upsun get ')[1].split(' && ')[0];
    expect(execFileSync('bash', ['-c', `printf '%s\\n' ${args}`], {encoding: 'utf8'}))
        .to.equal(`${projectId}\n/tmp/upsun-get\n`);
  });

  it('propagates unexpected filesystem errors when detecting the destination config', () => {
    expect(() => init.sources[0].build({destination: __filename})).to.throw().with.property('code', 'ENOTDIR');
  });

  describe('when the destination already holds an Upsun project', () => {
    const originalFetch = global.fetch;
    const originalLog = console.log;
    let printed;
    beforeEach(() => {
      printed = [];
      console.log = message => printed.push(message);
    });
    afterEach(() => {
      global.fetch = originalFetch;
      console.log = originalLog;
    });
    const account = id => {
      global.fetch = async url => ({ok: true, json: async () => String(url).endsWith('/oauth2/token') ?
        {access_token: 'access'} : {mail: 'dev@example.com', projects: [{name: 'foo', id}]}});
    };
    const fakeLando = {log: {verbose: () => {}}};

    for (const [source, name, vendor] of [
      ['upsun', 'fixed-root', 'platformsh'],
      ['platformsh', 'flex-drupal', 'upsun'],
      ['platformsh', 'mixed-config', 'platformsh'],
      ['upsun', 'no-config', 'upsun'],
      ['platformsh', 'no-config', 'platformsh'],
    ]) {
      it(`caches ${source} init tokens for ${vendor} in ${name}`, async () => {
        const store = {};
        const lando = {cache: {
          get: key => store[key],
          set: (key, value) => store[key] = value,
        }};
        account('abc');
        expect(await init.build({source, 'destination': fixture(name), 'name': 'foo',
          'upsun-site': 'foo', 'upsun-auth': 'tok'}, lando)).to.deep.equal({config: {id: 'abc'}});
        expect(store[`${vendor}.tokens`][0]).to.include({token: 'tok', email: 'dev@example.com'});
        expect(store[`${vendor === 'upsun' ? 'platformsh' : 'upsun'}.tokens`]).to.equal(undefined);
      });
    }

    it('routes browser login to the existing checkout vendor rather than the source', async () => {
      let vendor;
      login.promptBrowserLogin = async options => {
        vendor = options.vendor;
        return 'created';
      };
      const answers = {'source': 'upsun', 'recipe': 'upsun',
        'destination': fixture('fixed-root'), 'upsun-auth': 'browser'};
      await init.options(lando)['upsun-auth-browser'].interactive.when(answers);
      expect(vendor).to.equal('platformsh');
      expect(answers['upsun-auth']).to.equal('created');
    });

    for (const [name, source] of [['fixed-local-project', 0], ['flex-drupal', 1], ['mixed-config', 0]]) {
      it(`skips the clone for ${name}`, async () => {
        const destination = fixture(name);
        const steps = init.sources[source].build({'upsun-site': 'foo', 'upsun-auth': 'tok', destination});
        expect(steps.map(step => step.name)).to.deep.equal(['get-project-id']);
        account(name === 'fixed-local-project' ? 'fixedproj' : 'abc');
        const opts = {'upsun-site': 'foo', 'upsun-auth': 'tok', destination};
        await steps[0].func(opts, fakeLando);
        expect(opts['upsun-project-id']).to.equal(name === 'fixed-local-project' ? 'fixedproj' : 'abc');
        expect(printed).to.deep.equal([`Found an Upsun project in ${destination}; skipping the clone.`]);
      });
    }

    it('refuses a project other than the one the checkout is linked to', async () => {
      const destination = fixture('fixed-local-project');
      const [step] = init.sources[1].build({'upsun-site': 'foo', 'upsun-auth': 'tok', destination});
      account('otherproj');
      const error = await step.func({'upsun-site': 'foo', 'upsun-auth': 'tok', destination}, fakeLando)
          .then(() => null, error => error);
      expect(error.message).to.equal(`${destination} is linked to Upsun project fixedproj, not foo (otherproj). ` +
        'Choose that project, or run lando init --source cwd.');
      expect(printed).to.deep.equal([]);
    });
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
    expect(options['upsun-auth'].interactive.when({recipe: 'upsun', source: 'upsun'})).to.equal(true);
    expect(options['upsun-auth-token'].interactive.when({recipe: 'upsun', source: 'upsun'})).to.equal(false);
    expect(options['upsun-auth-token'].interactive.when({'recipe': 'upsun', 'source': 'upsun',
      'upsun-auth': 'more'})).to.equal(true);
  });

  it('defaults to browser login for first-time remote users', () => {
    const options = init.options(lando);
    expect(options['upsun-auth'].interactive.choices).to.deep.equal([
      {name: 'Log in with your browser', value: 'browser'}, {name: 'Paste an API token', value: 'more'},
    ]);
    expect(options['upsun-auth-browser'].hidden).to.equal(true);
    expect(options['upsun-auth-browser'].interactive).to.include({name: 'upsun-auth', weight: 515});
    expect(options['upsun-auth'].interactive.when({recipe: 'platformsh', source: 'platformsh'})).to.equal(true);
  });

  for (const source of ['upsun', 'platformsh']) {
    for (const result of ['created', undefined]) {
      it(`routes ${source} browser login to ${result ? 'the token' : 'paste'} when selected`, async () => {
        let passed;
        login.promptBrowserLogin = async options => {
          passed = options;
          return result;
        };
        const options = init.options(lando);
        const answers = {'source': source, 'recipe': 'upsun', 'upsun-auth': 'browser'};
        expect(await options['upsun-auth-browser'].interactive.when(answers)).to.equal(false);
        expect(passed).to.deep.equal({lando, vendor: source});
        expect(answers['upsun-auth']).to.equal(result || 'more');
        expect(options['upsun-auth-token'].interactive.when(answers)).to.equal(!result);
      });
    }
  }

  it('does not call browser login for other choices, recipes or local sources', async () => {
    login.promptBrowserLogin = async () => {
      throw new Error('Must not log in');
    };
    const question = init.options(lando)['upsun-auth-browser'].interactive;
    for (const answers of [
      {'source': 'upsun', 'recipe': 'upsun', 'upsun-auth': 'more'},
      {'source': 'upsun', 'recipe': 'upsun', 'upsun-auth': 'cached'},
      {'source': 'cwd', 'recipe': 'upsun', 'upsun-auth': 'browser'},
      {'source': 'upsun', 'recipe': 'drupal', 'upsun-auth': 'browser'},
    ]) expect(await question.when(answers)).to.equal(false);
  });

  it('keeps the default name prompt for local sources', () => {
    expect(init.overrides.name.when({source: 'cwd'})).to.equal(true);
    expect(init.overrides.name.when({source: 'cwd', name: 'x'})).to.equal(false);
    const remote = {'source': 'upsun', 'upsun-site': 'foo'};
    expect(init.overrides.name.when(remote)).to.equal(false);
    expect(remote.name).to.equal('foo');
  });
});
