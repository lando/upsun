'use strict';

const chai = require('chai');
chai.should();
const {getDependencySteps, getExtensionStep, renderPhpIni} = require('../lib/mapping/php');

describe('PHP mapping helpers', () => {
  it('quotes compound dependency constraints as one shell argument', () => {
    getDependencySteps({php: {tool: '^12 || ^13'}, nodejs: {tool: '^12 || ^13'},
      python: {tool: '^12 || ^13'}, ruby: {tool: '^12 || ^13'}}).should.eql([
      'npm install -g \'tool@^12 || ^13\'',
      'composer global require \'tool:^12 || ^13\'',
      'pip install --user \'tool==^12 || ^13\'',
      'gem install tool -v \'^12 || ^13\'',
    ]);
    for (const version of ['*', 'latest', true]) {
      getDependencySteps({php: {tool: version}}).should.eql(['composer global require tool']);
    }
    getDependencySteps({php: {tool: 'a\'b'}})[0].should.equal('composer global require \'tool:a\'\\\'\'b\'');
  });

  it('rejects shell payloads in enabled and disabled extension names', () => {
    for (const key of ['extensions', 'disabled_extensions']) {
      (() => getExtensionStep({[key]: ['xsl; echo injected']})).should.throw('Invalid PHP extension');
    }
  });

  it('renders variables.php as an ini string', () => {
    const ini = renderPhpIni({
      memory_limit: '256M',
      session: {save_handler: 'redis'},
      display_errors: true,
      error_log: '/tmp/a b.log',
    });

    ini.split('\n')[0].should.match(/^;/);
    ini.should.include('memory_limit = 256M');
    ini.should.include('session.save_handler = redis');
    ini.should.include('display_errors = On');
    ini.should.include('error_log = "/tmp/a b.log"');
  });

  it('builds the extension step and reports unsupported ones', () => {
    getExtensionStep({
      extensions: ['xsl', 'blackfire'],
      disabled_extensions: ['imap'],
    }).should.eql({
      step: '/helpers/upsun-php-extensions.sh --enable xsl --disable imap',
      unsupported: ['blackfire'],
    });
    getExtensionStep({extensions: [], disabled_extensions: []}).should.eql({step: null, unsupported: []});
  });

  it('renders dependency steps per language', () => {
    getDependencySteps({
      php: {'composer/composer': '^2', 'phpunit/phpunit': '^11'},
      python: {yq: '3.4.3'},
      ruby: {rake: '*'},
    }).should.eql([
      'composer global require phpunit/phpunit:^11',
      'pip install --user yq==3.4.3',
      'gem install rake',
    ]);
  });
});
