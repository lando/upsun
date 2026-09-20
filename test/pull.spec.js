'use strict';

const chai = require('chai');
chai.should();
const {getPullBuildSteps, getPullTask} = require('../lib/pull');

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

  it('exposes database client packages as root build steps', () => {
    getPullBuildSteps().should.eql([
      'apt-get update && apt-get install -y mariadb-client postgresql-client jq',
    ]);
  });
});
