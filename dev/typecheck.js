'use strict';

const path = require('path');
const ts = require('typescript');

const root = process.cwd();
const config = ts.readConfigFile(path.join(root, 'jsconfig.json').replace(/\\/g, '/'), ts.sys.readFile);
const parsed = config.error ? {errors: [config.error], fileNames: [], options: {}} :
  ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const diagnostics = parsed.errors.length ? parsed.errors :
  ts.getPreEmitDiagnostics(ts.createProgram(parsed.fileNames, parsed.options));
// Imported JavaScript dependencies are checked too; only this repository's errors belong to its gate.
const ownDiagnostics = diagnostics.filter(diagnostic =>
  !diagnostic.file || !path.relative(root, diagnostic.file.fileName).split(/[\\/]/).includes('node_modules'));

if (ownDiagnostics.length) {
  process.stderr.write(ts.formatDiagnostics(ownDiagnostics, {
    getCanonicalFileName: file => file,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  }));
}
process.exitCode = ownDiagnostics.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error) ? 1 : 0;
