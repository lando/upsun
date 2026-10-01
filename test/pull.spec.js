'use strict';

const chai = require('chai');
chai.should();
const pull = require('../lib/pull');
const {getPullTask} = pull;

const model = {
  flavor: 'flex',
  applications: {
    app: {
      relationships: {database: {service: 'db'}, cache: {service: 'redis'}},
      mounts: {'/files': {}, '/private': {}},
    },
  },
  services: {
    db: {type: {service: 'mariadb'}},
    redis: {type: {service: 'redis'}},
  },
};
const cli = {binary: 'upsun', tokenVar: 'UPSUN_CLI_TOKEN', vendor: 'upsun', projectId: 'project'};

describe('pull tooling', () => {
  it('targets the app service with isolated CLI environment', () => {
    const task = getPullTask(model, 'app', cli, [{token: 'secret'}]);
    task.should.include({service: 'app', cmd: '/helpers/upsun-pull.sh', level: 'app'});
    task.env.should.include({
      UPSUN_CLI_BINARY: 'upsun',
      UPSUN_CLI_TOKEN_VAR: 'UPSUN_CLI_TOKEN',
      UPSUN_CLI_TOKEN: 'secret',
      PLATFORM_PROJECT: 'project',
      PLATFORM_APPLICATION: '',
      PLATFORM_RELATIONSHIPS: '',
    });
  });

  it('offers only database relationships and all mounts', () => {
    const task = getPullTask(model, 'app', cli, []);
    task.options.relationship.interactive.choices.should.eql(['database']);
    task.options.mount.interactive.choices.should.eql(['/files', '/private']);
  });

  it('exposes --all-mounts, --skip-db, --skip-files and --app passthrough options', () => {
    const options = getPullTask(model, 'app', cli, []).options;
    options.should.include.keys('auth', 'relationship', 'mount', 'env', 'project', 'no-parent',
      'all-mounts', 'skip-db', 'skip-files', 'app');
    options.app.should.include({passthrough: true, string: true});
    options.app.alias.should.eql(['A']);
    options['skip-db'].boolean.should.equal(true);
    // Lando only copies argv flags into inquirer answers for options that carry an interactive block,
    // so the skip flags need a silent one for the relationship/mount prompts to see them
    options['skip-db'].interactive.when({}).should.equal(false);
    options['skip-db'].interactive.weight.should.be.below(options.relationship.interactive.weight);
    options['skip-files'].interactive.weight.should.be.below(options.mount.interactive.weight);
  });

  it('skips interactive prompts when --skip-db / --skip-files are given', () => {
    const options = getPullTask(model, 'app', cli, []).options;
    options.relationship.interactive.when({'skip-db': true}).should.equal(false);
    options.mount.interactive.when({'skip-files': true}).should.equal(false);
    options.relationship.interactive.when({}).should.equal(true);
    options.mount.interactive.when({}).should.equal(true);
  });

  it('no longer exports build steps', () => {
    pull.should.not.have.property('getPullBuildSteps');
  });
});
