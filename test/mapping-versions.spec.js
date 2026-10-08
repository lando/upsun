'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const chai = require('chai');
chai.should();
const {resolveVersion, getSupportedVersions, getVersionTableStatus, VERSION_TABLES} =
  require('../lib/mapping/versions');
const {toLandoWarning} = require('../lib/warnings');

describe('mapping versions', () => {
  it('falls back to frozen versions when an installed plugin reports no versions', () => {
    const resolved = resolveVersion('php', '8.4', []);
    resolved.version.should.equal('8.4');
    resolved.warning.code.should.equal('plugin-outdated');
    resolveVersion('php', '9.1', []).version.should.equal('8.5');
  });

  it('selects the numeric maximum from an unsorted installed version list', () => {
    resolveVersion('php', '10', ['8.2', '8.10', '8.9']).version.should.equal('8.10');
    resolveVersion('node', '99', ['9', '22', '10']).version.should.equal('22');
  });

  it('distinguishes unreadable installed builders from missing plugins and preserves the error', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-unreadable-'));
    try {
      const builders = path.join(temporary, 'builders');
      fs.mkdirSync(builders);
      fs.writeFileSync(path.join(builders, 'php.js'), 'throw new Error(\'broken plugin dependency\');\n');
      const plugins = [{name: '@lando/php', dir: temporary}];
      const versions = getSupportedVersions(plugins);
      const warnings = getVersionTableStatus(plugins, ['php'], versions);
      warnings.map(warning => warning.code).should.eql(['plugin-unreadable']);
      warnings[0].message.should.include('broken plugin dependency');
      resolveVersion('php', '8.4', versions.php).version.should.equal('8.4');
      getVersionTableStatus([], ['php']).map(warning => warning.code).should.eql(['plugin-missing']);
    } finally {
      fs.rmSync(temporary, {recursive: true, force: true});
    }
  });

  it('warns once when a needed plugin is missing', () => {
    const neededTypes = ['php', 'php'];

    const warnings = getVersionTableStatus([], neededTypes, {});

    warnings.map(({code, data}) => ({code, data})).should.eql([
      {code: 'plugin-missing', data: {landoType: 'php'}},
    ]);
  });

  it('warns when an installed plugin lacks the newest frozen version', () => {
    const versions = {php: ['8.4', '8.3']};

    const warnings = getVersionTableStatus([], new Set(['php']), versions);

    warnings.map(({code, data}) => ({code, data})).should.eql([
      {code: 'plugin-outdated', data: {landoType: 'php'}},
    ]);
  });

  it('warns outdated rather than missing when an installed version list is empty', () => {
    const versions = {php: []};

    const warnings = getVersionTableStatus([], ['php'], versions);

    warnings.map(warning => warning.code).should.eql(['plugin-outdated']);
  });

  it('does not warn when needed plugins include the newest frozen entries', () => {
    const versions = {php: ['8.3', '8.5'], node: ['26']};

    const warnings = getVersionTableStatus([], ['php', 'node'], versions);

    warnings.should.eql([]);
  });

  it('ignores unused plugins and non-versioned service types', () => {
    const versions = {php: ['8.3']};

    const warnings = getVersionTableStatus([], ['compose', 'nginx', 'mailpit'], versions);

    warnings.should.eql([]);
  });

  it('reads installed builders when versions are not supplied', () => {
    const plugins = [{name: '@lando/php', dir: path.join(__dirname, 'fixtures/plugins/@lando/php')}];

    const warnings = getVersionTableStatus(plugins, ['php']);

    warnings.map(warning => warning.code).should.eql(['plugin-outdated']);
  });

  for (const code of ['plugin-missing', 'plugin-outdated', 'plugin-unreadable']) {
    it(`links to the caveat anchor when translating ${code}`, () => {
      const warning = {code, message: 'Plugin warning', data: {landoType: 'php'}};

      const result = toLandoWarning(warning);

      result.url.should.equal(`https://docs.lando.dev/upsun/caveats.html#${code}`);
      result.title.should.not.equal(`Upsun: ${code}`);
    });
  }

  it('resolves exact and semantically exact versions without warnings', () => {
    resolveVersion('php', '8.4').should.eql({version: '8.4'});
    resolveVersion('postgres', '10.6').should.eql({version: '10.6.0'});
    resolveVersion('elasticsearch', '8.4').should.eql({version: '8.4.x'});
    resolveVersion('redis', '8.00').should.eql({version: '8.0'});
    resolveVersion('php', '8').should.eql({version: '8.0'});
    resolveVersion('memcached', '1.6').should.eql({version: '1.6'});
  });

  it('selects the nearest lower minor in the requested major', () => {
    const resolved = resolveVersion('php', '8.6');
    resolved.version.should.equal('8.5');
    resolved.warning.code.should.equal('version-fallback');
    resolved.warning.data.should.eql({landoType: 'php', wanted: '8.6', resolved: '8.5'});
    resolveVersion('redis', '8.1').version.should.equal('8.0');
  });

  it('selects the newest supported version when the major is unavailable', () => {
    const resolved = resolveVersion('php', '9.1');
    resolved.version.should.equal('8.5');
    resolved.warning.code.should.equal('version-unsupported');
  });

  it('includes supported and legacy versions from every bundled plugin', () => {
    Object.keys(VERSION_TABLES).should.have.members([
      'php', 'node', 'python', 'ruby', 'go', 'mariadb', 'mysql', 'postgres', 'redis',
      'memcached', 'mongo', 'solr', 'elasticsearch', 'varnish',
    ]);
    VERSION_TABLES.go.should.include('1.22');
    VERSION_TABLES.php.should.include('5.3');
  });

  it('rejects unknown Lando plugin types', () => {
    (() => resolveVersion('java', '21')).should.throw('Unknown Lando service type: java');
  });

  it('prefers a supplied supported list', () => {
    resolveVersion('php', '8.4', ['8.3', '8.2']).should.include({version: '8.3'});
    resolveVersion('php', '8.4', ['8.3', '8.2']).warning.code.should.equal('version-fallback');
    resolveVersion('php', '8.4', ['8.4']).should.eql({version: '8.4'});
    resolveVersion('java', '21', ['21']).should.eql({version: '21'});
  });

  it('regenerates from LANDO_PLUGINS_DIR', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-versions-'));
    try {
      const plugin = path.join(temporary, 'php', 'builders');
      const output = path.join(temporary, 'version-tables.js');
      fs.mkdirSync(plugin, {recursive: true});
      fs.writeFileSync(path.join(plugin, 'php.js'), `module.exports = {config: {supported: ['9.9']}};\n`);

      const script = path.join(__dirname, '..', 'dev', 'update-versions.js');
      const refused = spawnSync(process.execPath, [script], {
        encoding: 'utf8',
        env: {...process.env, LANDO_PLUGINS_DIR: temporary, UPSUN_VERSIONS_OUTPUT: output},
      });
      refused.status.should.equal(1);
      refused.stderr.should.include('Missing plugins: @lando/node');
      refused.stderr.should.include('Refusing to drop version tables');
      fs.existsSync(output).should.equal(false);
      const result = spawnSync(process.execPath, [script, '--allow-shrink'], {
        encoding: 'utf8',
        env: {...process.env, LANDO_PLUGINS_DIR: temporary, UPSUN_VERSIONS_OUTPUT: output},
      });
      result.status.should.equal(0, result.stderr);
      const generated = fs.readFileSync(output, 'utf8');
      generated.should.include(`'9.9'`);
      // Data only: the runtime helpers stay hand-written in versions.js
      generated.should.not.include('resolveVersion');
      require(output).should.eql({php: ['9.9']});
    } finally {
      fs.rmSync(temporary, {recursive: true, force: true});
    }
  });
});
