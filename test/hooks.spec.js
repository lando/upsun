'use strict';

const {expect} = require('chai');
const {getMountCommands, getStartCommands} = require('../lib/hooks');

const model = {
  applications: {
    app: {
      name: 'app',
      sourceRoot: '',
      type: {runtime: 'php', version: '8.4'},
      mounts: {'/files': {}, '/private': {}},
      hooks: {deploy: 'php deploy.php', post_deploy: 'php post-deploy.php'},
      web: {commands: {pre_start: 'php pre.php', start: null, post_start: 'php post.php'}},
      workers: {queue: {mounts: {'/queue': {}}}},
    },
    api: {
      name: 'api',
      sourceRoot: 'api',
      type: {runtime: 'nodejs', version: '22'},
      mounts: {},
      hooks: {},
      web: {commands: {pre_start: 'a', start: 'b', post_start: 'c'}},
      workers: {},
    },
  },
};

describe('lib/hooks', () => {
  it('creates mount directories under /app joined with the source root', () => {
    expect(getMountCommands(model.applications.api, {'/tmp-data': {}, '/cache': {}})).to.deep.equal([
      'mkdir -p "/app/api/tmp-data" "/app/api/cache"',
    ]);
    expect(getMountCommands(model.applications.api, {})).to.deep.equal([]);
  });

  it('orders the PHP app start commands like Upsun', () => {
    const statements = ['CREATE DATABASE IF NOT EXISTS `main`;', 'FLUSH PRIVILEGES;'];
    const result = getStartCommands(model, 'app', {
      databases: [{service: 'db', host: 'db', dialect: 'mysql', statements}],
    });

    expect(result.map(command => command.name)).to.deep.equal([
      'mounts',
      'db-init:db',
      'provisioned',
      'pre_start',
      'post_start',
      'deploy',
      'post_deploy',
    ]);
    expect(result[1].cmd).to.equal(
        `/helpers/upsun-db-init.sh db mysql ${Buffer.from(statements.join('\n')).toString('base64')}`,
    );
    expect(result.every(command => command.user === 'app')).to.equal(true);
  });

  it('runs pre_start through the wrapper for non-PHP apps', () => {
    expect(getStartCommands(model, 'api').map(command => command.name)).to.deep.equal(['provisioned', 'post_start']);
  });

  it('inserts the tether step as root and skips database init when tethered', () => {
    const result = getStartCommands(model, 'app', {
      tethered: true,
      tetherEnv: {UPSUN_CLI_BINARY: 'upsun', UPSUN_CLI_TOKEN: 'tok'},
      databases: [{service: 'db', host: 'db', dialect: 'mysql', statements: ['SELECT 1;']}],
    });

    expect(result.map(command => command.name)).to.deep.equal([
      'mounts',
      'tether',
      'provisioned',
      'pre_start',
      'post_start',
      'deploy',
      'post_deploy',
    ]);
    expect(result[1]).to.deep.equal({
      name: 'tether',
      cmd: '/helpers/upsun-tether.sh open',
      env: {UPSUN_CLI_BINARY: 'upsun', UPSUN_CLI_TOKEN: 'tok'},
      user: 'root',
    });
  });

  it('emits the provisioned marker after database init', () => {
    const databases = ['db', 'other'].map(service => ({
      service, host: service, dialect: 'mysql', statements: ['SELECT 1;'],
    }));
    for (const [opts, preceding] of [
      [{databases}, ['mounts', 'db-init:db', 'db-init:other']],
      [{}, ['mounts']],
      [{tethered: true, databases}, ['mounts', 'tether']],
    ]) {
      const commands = getStartCommands(model, 'app', opts);
      expect(commands.slice(0, preceding.length).map(command => command.name)).to.deep.equal(preceding);
      expect(commands[preceding.length]).to.deep.equal({
        name: 'provisioned',
        cmd: 'touch "${UPSUN_PROVISIONED_FILE:-/dev/shm/upsun-provisioned}"',
        user: 'app',
      });
      expect(commands.filter(command => command.name === 'provisioned')).to.have.length(1);
    }
  });

  it('limits workers and cron sidecars to mount creation', () => {
    expect(getStartCommands(model, 'app', {role: 'worker', worker: 'queue'})).to.deep.equal([{
      name: 'mounts',
      cmd: 'mkdir -p "/app/files" "/app/private" "/app/queue"',
      user: 'app',
    }]);
    expect(getStartCommands(model, 'app', {role: 'cron'})).to.deep.equal([{
      name: 'mounts',
      cmd: 'mkdir -p "/app/files" "/app/private"',
      user: 'app',
    }]);
    expect(getStartCommands(model, 'api', {role: 'worker'})).to.deep.equal([]);
  });

  it('omits hook entries that are not defined', () => {
    const emptyModel = {applications: {
      empty: {
        sourceRoot: '',
        type: {runtime: 'php', version: '8.4'},
        mounts: {},
        hooks: {},
        web: {commands: {pre_start: null, start: null, post_start: null}},
        workers: [],
      },
    }};

    expect(getStartCommands(emptyModel, 'empty')).to.deep.equal([{
      name: 'provisioned',
      cmd: 'touch "${UPSUN_PROVISIONED_FILE:-/dev/shm/upsun-provisioned}"',
      user: 'app',
    }]);
  });

  it('throws for unknown applications and returns fresh objects', () => {
    expect(() => getStartCommands(model, 'missing')).to.throw('Unknown Upsun application: missing');

    const first = getStartCommands(model, 'app');
    const second = getStartCommands(model, 'app');
    expect(first).to.not.equal(second);
    expect(first[0]).to.not.equal(second[0]);
  });
});
