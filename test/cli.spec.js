'use strict';

const chai = require('chai');
chai.should();
const {getCliEnv, getInstallStep, resolveCli} = require('../lib/cli');

describe('cli', () => {
  it('resolves the Flex CLI independently of available tokens', () => {
    resolveCli('flex', {
      env: {UPSUN_CLI_TOKEN: 'flex', PLATFORMSH_CLI_TOKEN: 'fixed'},
      landofile: {},
    }).should.include({
      binary: 'upsun',
      tokenVar: 'UPSUN_CLI_TOKEN',
      home: '~/.upsun-cli',
      vendor: 'upsun',
    });
  });

  it('resolves the Fixed CLI independently of available tokens', () => {
    resolveCli('fixed', {
      env: {UPSUN_CLI_TOKEN: 'flex', PLATFORMSH_CLI_TOKEN: 'fixed'},
      landofile: {},
    }).should.include({
      binary: 'platform',
      tokenVar: 'PLATFORMSH_CLI_TOKEN',
      home: '~/.platformsh',
      vendor: 'platformsh',
    });
  });

  it('builds an isolated Flex tooling environment', () => {
    getCliEnv('flex', {token: 'secret', projectId: 'project', environment: 'dev'}).should.eql({
      UPSUN_CLI_TOKEN: 'secret',
      PLATFORM_PROJECT: 'project',
      PLATFORM_ENVIRONMENT: 'dev',
      UPSUN_CLI_NO_INTERACTION: '1',
      PLATFORM_RELATIONSHIPS: '',
      PLATFORM_APPLICATION: '',
    });
  });

  it('omits optional project and environment values', () => {
    getCliEnv('fixed', {token: 'secret'}).should.eql({
      PLATFORMSH_CLI_TOKEN: 'secret',
      PLATFORMSH_CLI_NO_INTERACTION: '1',
      PLATFORM_RELATIONSHIPS: '',
      PLATFORM_APPLICATION: '',
    });
  });

  it('installs each CLI via the shared release-download helper', () => {
    getInstallStep('flex').should.equal('/helpers/upsun-install-cli.sh upsun');
    getInstallStep('fixed').should.equal('/helpers/upsun-install-cli.sh platform');
  });
});
