'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync, spawnSync} = require('child_process');
const {expect} = require('chai');
const {getSwitchTask} = require('../lib/switch');
const {getPullTask} = require('../lib/pull');
const {getMagentoTooling} = require('../lib/tooling');
const recipe = require('../builders/upsun');
const describeLinux = require('./helpers/describe-linux');

const fixture = name => path.join(__dirname, 'fixtures', name);
const script = path.join(__dirname, '..', 'scripts', 'upsun-switch.sh');
const model = {
  applications: {app: {relationships: {database: {service: 'db'}}, mounts: {'/web/files': {}}}},
  services: {db: {type: {service: 'mariadb'}}},
};
const cli = {binary: 'upsun', tokenVar: 'UPSUN_CLI_TOKEN', flavor: 'flex', projectId: 'proj', environment: 'old'};

describe('switch tooling', () => {
  it('uses the pull service and execution settings when building a switch task', () => {
    const task = getSwitchTask(model, 'app', cli);
    expect(task).to.include({service: 'app', cmd: '/helpers/upsun-switch.sh', level: 'app'});
    expect(task.stdio).to.deep.equal(['inherit', 'pipe', 'pipe']);
  });

  it('keeps sync options except env and all-mounts when building a switch task', () => {
    const task = getSwitchTask(model, 'app', cli);
    expect(task.options).to.have.all.keys(
      'auth', 'api-token', 'relationship', 'mount', 'project', 'app', 'skip-db', 'skip-files', 'no-parent');
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
      const result = new Recipe('upsun', {root, _app: app});
      if (layout === 'fixed-magento') {
        expect(result.tooling).not.to.have.property('switch <environment>');
        expect(result.tooling.switch.cmd).to.equal(getMagentoTooling('app').switch.cmd);
      } else {
        expect(result.tooling['switch <environment>'].cmd).to.equal('/helpers/upsun-switch.sh');
      }
    });
  }
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
      UPSUN_PULL_SCRIPT: fixture('mock-upsun-switch-pull.sh'), UPSUN_TETHERED: '',
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

  it('warns to restart when the app is tethered', () => {
    const stdout = run(['feature-x'], {UPSUN_TETHERED: '1'});
    expect(stdout).to.include('lando restart').and.to.include('feature-x');
  });

  it('does not pull when checkout fails', () => {
    expect(() => run(['feature-x'], {MOCK_CHECKOUT_RC: '7'})).to.throw().with.property('status', 7);
    expect(fs.existsSync(env.MOCK_PULL_LOG)).to.equal(false);
  });

  it('propagates the failure when pull fails', () => {
    expect(() => run(['feature-x'], {MOCK_PULL_RC: '8'})).to.throw().with.property('status', 8);
  });
});
