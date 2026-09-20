'use strict';

const fs = require('fs');
const path = require('path');

const YAML_FILE = /\.ya?ml$/i;
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'vendor']);

const existingFiles = directory => fs.existsSync(directory) ? fs.readdirSync(directory, {withFileTypes: true}) : [];

const findNestedApps = root => {
  const files = [];
  const visit = directory => {
    for (const entry of existingFiles(directory).sort((left, right) => left.name < right.name ? -1 : 1)) {
      const absolute = path.join(directory, entry.name);
      if (entry.isFile() && entry.name === '.platform.app.yaml') files.push(absolute);
      if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name) && entry.name !== '.platform') visit(absolute);
    }
  };
  visit(root);
  return files;
};

const configError = (code, message) => Object.assign(new Error(message), {code});

/**
 * Detect the Upsun configuration flavor and source files in a project.
 *
 * @param {string} root Absolute or relative project root.
 * @returns {{flavor: 'flex'|'fixed', files: string[]}}
 */
const detect = root => {
  const projectRoot = path.resolve(root);
  const upsunDirectory = path.join(projectRoot, '.upsun');
  const flexFiles = existingFiles(upsunDirectory)
    .filter(entry => entry.isFile() && YAML_FILE.test(entry.name))
    .map(entry => path.join(upsunDirectory, entry.name))
    .sort();

  const fixedFiles = findNestedApps(projectRoot);
  for (const name of ['applications.yaml', 'routes.yaml', 'services.yaml']) {
    const file = path.join(projectRoot, '.platform', name);
    if (fs.existsSync(file) && !fixedFiles.includes(file)) fixedFiles.push(file);
  }
  fixedFiles.sort();

  if (flexFiles.length && fixedFiles.length) {
    throw configError('UPSUN_MIXED_CONFIG', 'Project contains both Flex and Fixed Upsun configuration.');
  }
  if (flexFiles.length) return {flavor: 'flex', files: flexFiles};
  if (fixedFiles.length) return {flavor: 'fixed', files: fixedFiles};
  throw configError('UPSUN_NO_CONFIG', 'Project contains no Upsun configuration.');
};

exports.detect = detect;
