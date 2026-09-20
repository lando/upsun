'use strict';

const fs = require('fs');
const path = require('path');
const tar = require('tar');
const yaml = require('js-yaml');

/** Loader for Platform.sh YAML extensions. */
class UpsunYaml {
  constructor(baseDir = process.cwd()) {
    this.base = baseDir;
    const archive = new yaml.Type('!archive', {
      kind: 'scalar',
      resolve: data => typeof data === 'string' && fs.existsSync(path.resolve(this.base, data)),
      construct: data => {
        const directory = path.resolve(this.base, data);
        const stream = tar.create({gzip: true, cwd: directory, sync: true}, fs.readdirSync(directory));
        stream.setEncoding('base64');
        return stream.read();
      },
    });
    const includeMapping = new yaml.Type('!include', {
      kind: 'mapping',
      resolve: data => typeof data?.path === 'string' && fs.existsSync(path.resolve(this.base, data.path)),
      construct: data => {
        const file = path.resolve(this.base, data.path);
        if (data.type === 'binary') return fs.readFileSync(file, {encoding: 'base64'});
        if (data.type === 'string') return fs.readFileSync(file, {encoding: 'utf8'});
        return this.load(file);
      },
    });
    const includeScalar = new yaml.Type('!include', {
      kind: 'scalar',
      resolve: data => typeof data === 'string' && fs.existsSync(path.resolve(this.base, data)),
      construct: data => this.load(path.resolve(this.base, data)),
    });
    this.schema = yaml.Schema.create([archive, includeMapping, includeScalar]);
  }

  load(file) {
    const previousBase = this.base;
    this.base = path.dirname(file);
    try {
      return yaml.load(fs.readFileSync(file), {schema: this.schema});
    } finally {
      this.base = previousBase;
    }
  }
}

module.exports = UpsunYaml;
