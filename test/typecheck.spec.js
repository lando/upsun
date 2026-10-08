'use strict';

const {expect} = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const vm = require('vm');
const ts = require('typescript');

describe('repository typecheck', () => {
  let root;
  const script = path.join(__dirname, '../dev/typecheck.js');
  const run = (cwd = root) => spawnSync(process.execPath, [script], {cwd, encoding: 'utf8', timeout: 10000});

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-typecheck-'));
    fs.writeFileSync(path.join(root, 'jsconfig.json'), JSON.stringify({
      compilerOptions: {allowJs: true, checkJs: true, noEmit: true, types: [], skipLibCheck: true},
      include: ['app.js'],
    }));
  });
  afterEach(() => fs.rmSync(root, {recursive: true, force: true}));

  it('fails on repository diagnostics while excluding dependency diagnostics', () => {
    const dependency = path.join(root, 'node_modules/broken');
    fs.mkdirSync(dependency, {recursive: true});
    fs.writeFileSync(path.join(dependency, 'index.ts'), 'export const value: number = "dependency-error";\n');
    fs.writeFileSync(path.join(root, 'app.js'),
      'require("broken");\n/** @type {number} */\nconst count = "project-error";\n');
    const result = run();
    expect(result.status, result.stderr).to.equal(1);
    expect(result.stderr).to.include('app.js').and.include('TS2322').and.not.include('node_modules');
  });

  it('succeeds when only dependency diagnostics remain', () => {
    const dependency = path.join(root, 'node_modules/broken');
    fs.mkdirSync(dependency, {recursive: true});
    fs.writeFileSync(path.join(dependency, 'index.ts'), 'export const value: number = "dependency-error";\n');
    fs.writeFileSync(path.join(root, 'app.js'), 'require("broken");\n');
    const result = run();
    expect(result.status, result.stderr).to.equal(0);
    expect(result.stderr).to.equal('');
  });

  it('fails on malformed configuration', () => {
    fs.writeFileSync(path.join(root, 'jsconfig.json'), '{"compilerOptions":');
    const result = run();
    expect(result.status, result.stderr).to.equal(1);
    expect(result.stderr).to.include('jsconfig.json').and.include('error TS1109');
  });

  it('reports malformed configuration with Windows paths on every host', () => {
    fs.writeFileSync(path.join(root, 'jsconfig.json'), '{"compilerOptions":');
    let stderr = '';
    const isolatedProcess = {
      cwd: () => 'D:\\temp',
      stderr: {write: text => {
        stderr += text;
      }},
      exitCode: 0,
    };
    // Keep the real parser; only map Windows filenames to the native fixture directory.
    const compiler = {...ts, sys: {...ts.sys,
      readFile: file => ts.sys.readFile(path.join(root, path.win32.basename(file))),
    }};

    vm.runInNewContext(fs.readFileSync(script, 'utf8'), {
      require: name => name === 'path' ? path.win32 : compiler,
      process: isolatedProcess,
    }, {filename: script, timeout: 10000});

    expect(isolatedProcess.exitCode, stderr).to.equal(1);
    expect(stderr).to.include('jsconfig.json').and.include('error TS1109').and.not.include('Debug Failure');
  });

  it('does not hide repository errors when the checkout is nested under node_modules', () => {
    const checkout = path.join(root, 'node_modules/checked-repository');
    fs.mkdirSync(checkout, {recursive: true});
    fs.copyFileSync(path.join(root, 'jsconfig.json'), path.join(checkout, 'jsconfig.json'));
    fs.writeFileSync(path.join(checkout, 'app.js'), '/** @type {number} */\nconst count = "project-error";\n');
    const result = run(checkout);
    expect(result.status, result.stderr).to.equal(1);
    expect(result.stderr).to.include('app.js').and.include('TS2322');
  });

  it('fails when the configuration is missing', () => {
    fs.unlinkSync(path.join(root, 'jsconfig.json'));
    const result = run();
    expect(result.status, result.stderr).to.equal(1);
    expect(result.stderr).to.include('jsconfig.json');
  });
});
