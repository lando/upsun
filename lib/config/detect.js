'use strict';

const fs = require('fs');
const path = require('path');

const YAML_FILE = /\.ya?ml$/i;
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'vendor']);

const existingFiles = directory => fs.existsSync(directory) ? fs.readdirSync(directory, {withFileTypes: true}) : [];

const findNestedApps = (root, appFile, configDirectory) => {
  const files = [];
  const visit = directory => {
    for (const entry of existingFiles(directory).sort((left, right) => left.name < right.name ? -1 : 1)) {
      const absolute = path.join(directory, entry.name);
      if (entry.isFile() && entry.name === appFile) files.push(absolute);
      if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name) && entry.name !== configDirectory) {
        visit(absolute);
      }
    }
  };
  visit(root);
  return files;
};

const configError = (code, message) => Object.assign(new Error(message), {code});

const fixedFiles = (root, layout, names) => {
  const files = findNestedApps(root, `.${layout}.app.yaml`, `.${layout}`);
  for (const name of names) {
    const file = path.join(root, `.${layout}`, name);
    if (fs.existsSync(file) && !files.includes(file)) files.push(file);
  }
  return files.sort();
};

/**
 * Detect the Upsun configuration flavor and source files in a project.
 *
 * @param {string} root Absolute or relative project root.
 * @returns {import('./config.types').ConfigDetection}
 */
const detect = root => {
  const projectRoot = path.resolve(root);
  const upsunDirectory = path.join(projectRoot, '.upsun');
  const flexFiles = existingFiles(upsunDirectory)
    .filter(entry => entry.isFile() && YAML_FILE.test(entry.name))
    .map(entry => path.join(upsunDirectory, entry.name))
    .sort();

  const platformFiles = fixedFiles(projectRoot, 'platform', ['applications.yaml', 'routes.yaml', 'services.yaml']);
  const magentoFiles = fixedFiles(projectRoot, 'magento', ['routes.yaml', 'services.yaml']);

  if (magentoFiles.length && (platformFiles.length || flexFiles.length)) {
    throw configError('UPSUN_MIXED_CONFIG', 'Project contains both Magento and Upsun configuration.');
  }
  if (flexFiles.length && platformFiles.length) {
    throw configError('UPSUN_MIXED_CONFIG', 'Project contains both Flex and Fixed Upsun configuration.');
  }
  if (flexFiles.length) return {flavor: 'flex', layout: 'upsun', files: flexFiles};
  if (platformFiles.length) return {flavor: 'fixed', layout: 'platform', files: platformFiles};
  if (magentoFiles.length) return {flavor: 'fixed', layout: 'magento', files: magentoFiles};
  throw configError('UPSUN_NO_CONFIG', 'Project contains no Upsun configuration.');
};

exports.detect = detect;
