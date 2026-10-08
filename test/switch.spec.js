'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync: execFileSyncRaw, spawnSync: spawnSyncRaw} = require('child_process');
const childEnv = (overrides = {}) => {
  const env = {...process.env, ...overrides};
  delete env.BASH_ENV;
  delete env.ENV;
  delete env.SHELLOPTS;
  delete env.BASHOPTS;
  return env;
};
const execFileSync = (file, args, options = {}) => execFileSyncRaw(file, args,
  {...options, timeout: 10000, env: childEnv(options.env)});
const spawnSync = (file, args, options = {}) => spawnSyncRaw(file, args,
  {...options, timeout: 10000, env: childEnv(options.env)});
const {expect} = require('chai');
const {getSwitchTask} = require('../lib/switch');
const {getPullTask} = require('../lib/pull');
const {getMagentoTooling} = require('../lib/tooling');
const recipe = require('../builders/upsun');
const describeLinux = require('./helpers/describe-linux');
const CoreCli = require('@lando/core/lib/cli');
const {getInteractive} = require('@lando/core/lib/formatters');
const yargs = require('yargs/yargs');

const fixture = name => path.join(__dirname, 'fixtures', name);
const script = path.join(__dirname, '..', 'scripts', 'upsun-switch.sh');
const model = {
  applications: {app: {relationships: {database: {service: 'db'}}, mounts: {'/web/files': {}}}},
  services: {db: {type: {service: 'mariadb'}}},
};
const cli = {binary: 'upsun', tokenVar: 'UPSUN_CLI_TOKEN', flavor: 'flex', projectId: 'proj', environment: 'old'};

const buildTooling = (layout = 'flex-drupal') => {
  const root = fixture(layout);
  const app = {
    name: 'switch-test', root, project: 'switch-test', upsun: {branch: 'main'},
    _config: {domain: 'lndo.site', landoFile: '.lando.yml'},
    _lando: {cache: {get: () => []}, config: {plugins: []}},
    config: {recipe: 'upsun', config: {}},
  };
  const Recipe = recipe.builder(class {
    constructor(id, config) {
      this.id = id;
      this.tooling = config.tooling;
    }
  }, recipe.config);
  return new Recipe('upsun', {root, _app: app}).tooling;
};

describe('switch tooling', () => {
  it('excludes Fixed replica relationships from database choices', () => {
    const task = getSwitchTask({applications: {app: {relationships: {
      readonly: {service: 'replica', endpoint: 'postgresql'}, database: {service: 'db', endpoint: 'postgresql'},
    }}}, services: {replica: {type: {service: 'postgres-replica'}}, db: {type: {service: 'postgresql'}}}},
    'app', {...cli, binary: 'platform', flavor: 'fixed'});
    expect(task.options.relationship.interactive.choices).to.deep.equal(['database']);
  });

  it('uses the pull service and execution settings when building a switch task', () => {
    const task = getSwitchTask(model, 'app', cli);
    expect(task).to.include({service: 'app', cmd: '/helpers/upsun-switch.sh', level: 'app'});
    expect(task.stdio).to.deep.equal(['inherit', 'pipe', 'pipe']);
  });

  it('keeps sync options except env and all-mounts when building a switch task', () => {
    const task = getSwitchTask(model, 'app', cli);
    expect(task.options).to.have.all.keys(
      'auth', 'api-token', 'relationship', 'mount', 'project', 'app', 'skip-db', 'skip-files', 'no-parent',
      'environment');
    expect(task.options['api-token'].hidden).to.equal(true);
    for (const [name, option] of Object.entries(task.options)) {
      if (name !== 'api-token') expect(option.passthrough).to.equal(true);
    }
  });

  for (const binary of ['upsun', 'platform']) {
    it(`preserves the pull environment when using ${binary}`, () => {
      const selected = {...cli, binary, flavor: binary === 'upsun' ? 'flex' : 'fixed'};
      const tokens = [{email: 'dev@example.com', token: 'cached'}];
      const task = getSwitchTask(model, 'app', selected, tokens);
      expect(task.env).to.deep.equal(getPullTask(model, 'app', selected, tokens).env);
    });
  }

  it('suppresses data selection prompts when the skip answers are set', () => {
    const task = getSwitchTask(model, 'app', cli);
    expect(task.options.relationship.interactive.when({'skip-db': true})).to.equal(false);
    expect(task.options.mount.interactive.when({'skip-files': true})).to.equal(false);
  });

  it('exits 1 when the Magento switch stub runs', () => {
    const task = getMagentoTooling('app').switch;
    const result = spawnSync('sh', ['-c', task.cmd], {encoding: 'utf8'});
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('magento-cloud');
  });

  for (const layout of ['flex-drupal', 'fixed-magento']) {
    it(`registers the appropriate switch command when building ${layout}`, () => {
      const tooling = buildTooling(layout);
      if (layout === 'fixed-magento') {
        expect(tooling).not.to.have.property('switch [environment]');
        expect(tooling.switch.cmd).to.equal(getMagentoTooling('app').switch.cmd);
      } else {
        expect(tooling['switch [environment]'].cmd).to.equal('/helpers/upsun-switch.sh');
      }
    });
  }
});

describe('switch environment selection at the core boundary', () => {
  const originalFetch = global.fetch;
  let requests;
  beforeEach(() => {
    requests = [];
    global.fetch = async (url, options) => {
      requests.push({url, options});
      return new Response(JSON.stringify(url.endsWith('/oauth2/token') ? {access_token: 'access'} : [
        {id: 'main', title: 'Main', status: 'active', type: 'production'},
        {id: 'feature', title: 'Feature', status: 'inactive', type: 'development'},
      ]));
    };
  });
  afterEach(() => global.fetch = originalFetch);

  for (const status of [400, 401, 403]) {
    it(`reports rejected tokens clearly for HTTP ${status}`, async () => {
      global.fetch = async () => new Response(JSON.stringify({message: 'Denied'}), {status});
      const task = getSwitchTask(model, 'app', cli);
      const error = await task.options.environment.interactive.choices({auth: 'bad'}).catch(error => error);
      expect(error.message).to.equal('Upsun rejected that API token. Run lando auth upsun again.');
    });
  }

  it('includes project context for non-auth environment-list failures', async () => {
    global.fetch = async () => new Response(JSON.stringify({message: 'Missing project'}), {status: 404});
    const task = getSwitchTask(model, 'app', cli);
    const error = await task.options.environment.interactive.choices({auth: 'token'}).catch(error => error);
    expect(error.message).to.equal('Couldn\'t list environments for proj: Missing project');
  });

  // Use core's actual option/positional builder and formatter, including its early argv read.
  const buildSwitch = () => buildTooling()['switch [environment]'];
  const parse = (task, args) => {
    const parser = yargs(args).help(false).version(false).exitProcess(false);
    void parser.argv;
    const command = CoreCli.prototype.parseToYargs.call({}, {
      ...task, command: 'switch [environment]',
    });
    let parsed;
    parser.command({...command, handler: argv => parsed = argv});
    void parser.argv;
    return parsed;
  };

  for (const cached of [false, true]) {
    const shape = cached ? 'serialized' : 'live';
    const inputs = [[], ['feature-x'], ['--environment', 'feature-x'], ['--env', 'feature-x'], ['-e', 'feature-x']];
    for (const args of inputs) {
      it(`only offers the picker with no environment (${shape} builder): ${args.join(' ')}`, async () => {
        const task = buildSwitch();
        const argv = parse(cached ? JSON.parse(JSON.stringify(task)) : task, ['switch', ...args]);
        // Core reloads live app prompts after parsing cached tooling.
        const question = getInteractive(task.options, argv).find(question => question.name === 'environment');
        const answers = {auth: 'selected-token'};
        expect(argv.environment).to.equal(args.length ? 'feature-x' : undefined);
        expect(await question.when(answers)).to.equal(args.length === 0);
        if (args.length) expect(answers.environment).to.equal('feature-x');
        expect(requests).to.have.length(0);
      });
    }

    it(`does not run environment inquiries or fetch for help (${shape} builder)`, () => {
      const task = buildSwitch();
      const command = CoreCli.prototype.parseToYargs.call({}, {
        ...(cached ? JSON.parse(JSON.stringify(task)) : task), command: 'switch [environment]',
      });
      let ran = false;
      let output;
      const parser = yargs(['switch', '--help']).help(false).version(false).exitProcess(false);
      void parser.argv;
      parser.command({...command, handler: () => ran = true}).help()
        .parse(['switch', '--help'], (error, argv, help) => {
        expect(error).to.equal(undefined);
        expect(argv.help).to.equal(true);
        output = help;
      });
      expect(output).to.include('switch [environment]');
      expect(ran).to.equal(false);
      expect(requests).to.have.length(0);
    });
  }

  it('lists all environments with the selected token and project, retaining IDs as values', async () => {
    const task = {...buildSwitch(), ...getSwitchTask(model, 'app', cli)};
    const argv = parse(task, ['switch', '--project', 'chosen']);
    const answers = {auth: 'selected-token'};
    const questions = getInteractive(task.options, argv).sort((a, b) => a.weight - b.weight);
    for (const question of questions.filter(question => question.name === 'project')) await question.when(answers);
    const question = questions.find(question => question.name === 'environment');
    const choices = await question.choices(answers);
    expect(choices.map(choice => choice.value)).to.deep.equal(['main', 'feature']);
    expect(choices[0].name).to.include('Main').and.include('main');
    expect(JSON.parse(requests[0].options.body).api_token).to.equal('selected-token');
    expect(requests[1].url).to.equal('https://api.upsun.com/projects/chosen/environments');
  });

  it('uses the configured project when none was selected', async () => {
    await getSwitchTask(model, 'app', cli).options.environment.interactive.choices({auth: 'selected-token'});
    expect(requests[1].url).to.equal('https://api.upsun.com/projects/proj/environments');
  });

  it('copies the app-cached auth default into answers before listing environments', async () => {
    const account = {email: 'cached@example.com', token: 'app-cached'};
    const task = {...buildSwitch(), ...getSwitchTask(model, 'app', cli, [], undefined, account)};
    const argv = parse(task, ['switch']);
    expect(argv.auth).to.equal('app-cached');
    const answers = {};
    const questions = getInteractive(task.options, argv).sort((a, b) => a.weight - b.weight);
    for (const question of questions.filter(question => question.name === 'auth')) await question.when(answers);
    await questions.find(question => question.name === 'environment').choices(answers);
    expect(JSON.parse(requests[0].options.body).api_token).to.equal('app-cached');
  });

  it('fails clearly without a project before fetching', async () => {
    const task = getSwitchTask(model, 'app', {...cli, projectId: undefined});
    const error = await task.options.environment.interactive.choices({auth: 'token'}).catch(error => error);
    expect(error.message).to.match(/project.*--project/i);
    expect(requests).to.have.length(0);
  });

  it('fails clearly when the project has no environments', async () => {
    global.fetch = async url => new Response(JSON.stringify(url.endsWith('/oauth2/token') ?
      {access_token: 'access'} : []));
    const task = getSwitchTask(model, 'app', cli);
    const error = await task.options.environment.interactive.choices({auth: 'token'}).catch(error => error);
    expect(error.message).to.match(/no environments.*proj/i);
  });
});

describeLinux('Upsun switch script', () => {
  let root;
  let env;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-switch-'));
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    fs.copyFileSync(fixture('mock-upsun-switch-cp.sh'), path.join(bin, 'cp'));
    fs.chmodSync(path.join(bin, 'cp'), 0o755);
    fs.writeFileSync(path.join(root, '.lando.yml'), 'name: original\n');
    env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      LANDO_MOUNT: root,
      UPSUN_LOG_HELPER: fixture('log.sh'),
      UPSUN_SYNC_ENV: path.join(__dirname, '..', 'scripts', 'upsun-sync-env.sh'),
      UPSUN_CLI_BINARY: fixture('mock-upsun-switch-cli.sh'),
      UPSUN_CLI_TOKEN_VAR: 'UPSUN_CLI_TOKEN', UPSUN_CLI_TOKEN: 'cached', MOCK_AUTH: 'cached',
      UPSUN_PULL_SCRIPT: fixture('mock-upsun-switch-pull.sh'),
      PLATFORM_PROJECT: 'project', PLATFORM_RELATIONSHIPS: 'local', PLATFORM_APPLICATION: 'local',
      MOCK_PLATFORM_LOG: path.join(root, 'cli.log'), MOCK_PULL_LOG: path.join(root, 'pull.log'),
    };
  });
  afterEach(() => fs.rmSync(root, {recursive: true, force: true}));

  const run = (args, overrides = {}) => execFileSync('bash', [script, ...args], {
    cwd: os.tmpdir(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: {...env, ...overrides},
  });
  const log = () => fs.readFileSync(env.MOCK_PLATFORM_LOG, 'utf8');
  const pullArgs = () => fs.readFileSync(env.MOCK_PULL_LOG, 'utf8').trimEnd().split('\n');

  for (const flag of ['--environment', '--env', '-e']) {
    it(`checks out an explicit ${flag} environment with no-* aliases`, () => {
      run([flag, 'feature-x', '--no-db', '--no-files']);
      expect(log()).to.include('environment:checkout feature-x -p project');
      expect(fs.existsSync(env.MOCK_PULL_LOG)).to.equal(false);
    });
  }

  it('authenticates, binds and checks out from the repo root when both sync steps are skipped', () => {
    run(['feature-x', '--skip-db', '--skip-files']);
    expect(log().trim().split('\n')).to.deep.equal([
      'auth:info', 'project:set-remote -y project', 'environment:checkout feature-x -p project',
    ]);
    expect(fs.existsSync(env.MOCK_PULL_LOG)).to.equal(false);
  });

  it('restores the original Landofile when checkout removes it', () => {
    run(['feature-x', '--skip-db', '--skip-files'], {MOCK_DELETE_LANDOFILE: '1'});
    expect(fs.readFileSync(path.join(root, '.lando.yml'), 'utf8')).to.equal('name: original\n');
  });

  it('preserves the target Landofile when checkout supplies one', () => {
    run(['feature-x', '--skip-db', '--skip-files'], {MOCK_TARGET_LANDOFILE: '1'});
    expect(fs.readFileSync(path.join(root, '.lando.yml'), 'utf8')).to.equal('name: target\n');
  });

  it('leaves the Landofile absent when the original branch has none', () => {
    fs.unlinkSync(path.join(root, '.lando.yml'));
    run(['feature-x', '--skip-db', '--skip-files']);
    expect(fs.existsSync(path.join(root, '.lando.yml'))).to.equal(false);
  });

  for (const args of [[], ['--skip-db', '--skip-files']]) {
    it(`exits 1 before contacting Upsun when the positional is missing (${args.join(' ')})`, () => {
      const result = spawnSync('bash', [script, ...args], {encoding: 'utf8', env});
      expect(result.status).to.equal(1);
      expect(result.stderr).to.include('environment ID is required');
      expect(fs.existsSync(env.MOCK_PLATFORM_LOG)).to.equal(false);
    });
  }

  it('forwards selections and the switched environment when pulling', () => {
    run(['feature-x', '-r', 'db', '-m', '/web/files', '--no-parent', '-A', 'web', '-p', 'selected']);
    expect(pullArgs()).to.deep.equal([
      '--env', 'feature-x', '-r', 'db', '-m', '/web/files', '--no-parent', '-A', 'web', '-p', 'selected',
    ]);
  });

  it('extracts the positional when Lando prepends auth and selection flags', () => {
    run(['--auth=explicit', '--relationship=db', '--mount=/web/files', 'feature-x'], {MOCK_AUTH: 'explicit'});
    expect(pullArgs()).to.deep.equal([
      '--env', 'feature-x', '--auth=explicit', '--relationship=db', '--mount=/web/files',
    ]);
  });

  for (const flag of ['--skip-db', '--skip-files']) {
    it(`still invokes pull when only ${flag} is set`, () => {
      run(['feature-x', flag]);
      expect(pullArgs()).to.deep.equal(['--env', 'feature-x', flag]);
    });
  }

  it('skips pulling when Lando passes both skip flags in equals form', () => {
    run(['--skip-db=true', '--skip-files=true', 'feature-x']);
    expect(fs.existsSync(env.MOCK_PULL_LOG)).to.equal(false);
  });

  it('discovers the project when none is configured', () => {
    run(['feature-x', '--skip-db', '--skip-files'], {PLATFORM_PROJECT: ''});
    expect(log()).to.include('project:info id\nenvironment:checkout feature-x -p discovered-project');
  });

  it('does not pull when checkout fails', () => {
    expect(() => run(['feature-x'], {MOCK_CHECKOUT_RC: '7'})).to.throw().with.property('status', 7);
    expect(fs.existsSync(env.MOCK_PULL_LOG)).to.equal(false);
  });

  it('propagates the failure when pull fails', () => {
    expect(() => run(['feature-x'], {MOCK_PULL_RC: '8'})).to.throw().with.property('status', 8);
  });
});
