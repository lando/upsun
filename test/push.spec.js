'use strict';

const chai = require('chai');
chai.should();
const {getPushTask} = require('../lib/push');

describe('push tooling', () => {
  it('adds the production force guard option', () => {
    const task = getPushTask({
      applications: {app: {relationships: {}, mounts: {}}},
      services: {},
    }, 'app', {binary: 'platform', tokenVar: 'PLATFORMSH_CLI_TOKEN', vendor: 'platformsh'}, []);
    task.should.include({service: 'app', cmd: '/helpers/upsun-push.sh', level: 'app'});
    task.options.force.should.include({passthrough: true, boolean: true});
    task.env.should.include({
      UPSUN_CLI_BINARY: 'platform',
      UPSUN_CLI_TOKEN_VAR: 'PLATFORMSH_CLI_TOKEN',
      PLATFORM_APPLICATION: '',
      PLATFORM_RELATIONSHIPS: '',
    });
  });
});
