'use strict';

const fs = require('fs');
const path = require('path');
const tar = require('tar');
const yaml = require('js-yaml');

/** Loader for Platform.sh YAML extensions. */
class UpsunYaml {
  constructor(baseDir = process.cwd(), projectRoot = baseDir) {
    this.base = baseDir;
    this.root = fs.realpathSync(projectRoot);
    this.loading = [];
    const archive = new yaml.Type('!archive', {
      kind: 'scalar',
      resolve: data => typeof data === 'string' && fs.existsSync(this.resolvePath(data)),
      construct: data => {
        const directory = this.resolvePath(data);
        return tar.create({gzip: true, cwd: directory, sync: true}, fs.readdirSync(directory))
            .read().toString('base64');
      },
    });
    const includeMapping = new yaml.Type('!include', {
      kind: 'mapping',
      resolve: data => typeof data?.path === 'string' && fs.existsSync(this.resolvePath(data.path)),
      construct: data => {
        const file = this.resolvePath(data.path);
        if (data.type === 'binary') return fs.readFileSync(file, {encoding: 'base64'});
        if (data.type === 'string') return fs.readFileSync(file, {encoding: 'utf8'});
        return this.load(file);
      },
    });
    const includeScalar = new yaml.Type('!include', {
      kind: 'scalar',
      resolve: data => typeof data === 'string' && fs.existsSync(this.resolvePath(data)),
      construct: data => this.load(this.resolvePath(data)),
    });
    this.schema = yaml.DEFAULT_SCHEMA.extend([archive, includeMapping, includeScalar]);
  }

  resolvePath(value) {
    const traversesParent = relative => relative === '..' || relative.startsWith(`..${path.sep}`);
    const file = path.resolve(this.base, value);
    const relative = path.relative(this.root, file);
    if (path.isAbsolute(value) || traversesParent(relative)) {
      throw new Error(`YAML path escapes project root: ${value}`);
    }
    if (fs.existsSync(file)) {
      const real = path.relative(this.root, fs.realpathSync(file));
      // Windows cross-drive relative paths are absolute, so parent traversal alone cannot catch them.
      if (traversesParent(real) || path.isAbsolute(real)) {
        throw new Error(`YAML path escapes project root: ${value}`);
      }
    }
    return file;
  }

  load(file) {
    const canonical = fs.realpathSync(file);
    if (this.loading.includes(canonical)) {
      const chain = [...this.loading, canonical].map(entry => path.relative(this.root, entry)).join(' -> ');
      throw new Error(`Circular YAML include: ${chain}`);
    }
    const previousBase = this.base;
    this.base = fs.realpathSync(path.dirname(file));
    this.loading.push(canonical);
    try {
      return yaml.load(fs.readFileSync(file, 'utf8'), {schema: this.schema});
    } finally {
      this.loading.pop();
      this.base = previousBase;
    }
  }
}

module.exports = UpsunYaml;
