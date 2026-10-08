'use strict';

const _ = require('lodash');
const path = require('path');
const fs = require('fs');
const {execSync} = require('child_process');

const {load} = require('./config/index');

const DOCS = 'https://docs.lando.dev/upsun/config.html';

/**
 * Current git branch of the project, falling back to `main`.
 * @param {string} root Project root.
 * @returns {string} Branch name.
 */
const getBranch = root => {
  try {
    return execSync('git symbolic-ref --short HEAD', {cwd: root, stdio: ['ignore', 'pipe', 'ignore']})
        .toString().trim() || 'main';
  } catch {
    return 'main';
  }
};

/**
 * Pick the model application the Landofile belongs to.
 * @param {import('./config/config.types').UpsunModel} model Normalized model.
 * @param {string} root Project root.
 * @param {string} landoDir Directory containing the Landofile.
 * @param {string} [explicit] App name from `config.app`.
 * @returns {string} App name.
 */
const getClosestApp = (model, root, landoDir, explicit) => {
  const names = Object.keys(model.applications);
  if (explicit) {
    if (!names.includes(explicit)) throw new Error(`config.app "${explicit}" is not one of: ${names.join(', ')}`);
    return explicit;
  }
  if (names.length === 1) return names[0];
  const rel = path.relative(root, landoDir).split(path.sep).join('/');
  return _(names)
      .filter(name => {
        const src = model.applications[name].sourceRoot;
        return src === '' || rel === src || rel.startsWith(`${src}/`);
      })
      .maxBy(name => model.applications[name].sourceRoot.length) || names[0];
};

// Package names an app's composer project pulls in (root requires + lockfile), for framework tooling
const readJson = file => {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/**
 * Collect composer package names from composer.json and composer.lock in a directory.
 * @param {string} dir Directory containing composer files.
 * @returns {Set<string>} Package names.
 */
const getComposerPackages = dir => {
  const json = readJson(path.join(dir, 'composer.json'));
  const lock = readJson(path.join(dir, 'composer.lock'));
  return new Set([
    ...Object.keys(json?.require || {}),
    ...Object.keys(json?.['require-dev'] || {}),
    ...(lock?.packages || []).map(pkg => pkg.name),
    ...(lock?.['packages-dev'] || []).map(pkg => pkg.name),
  ]);
};

/**
 * Keys defined in Landofile env_file entries (Compose env wins over these).
 * @param {string[]} [files] Env file paths.
 * @returns {string[]} Variable names.
 */
const getEnvFileKeys = (files = []) => files.flatMap(file => {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').flatMap(line => {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:[=:]|$)/.exec(line);
      return match ? [match[1]] : [];
    });
  } catch {
    return [];
  }
});

/**
 * Load the Upsun model for a project root, with user-facing config errors.
 * Raw overrides and legacy variables are applied by the config loader before normalization.
 * @param {string} root Project root.
 * @param {import('./config/config.types').ConfigLoadOptions} [options] Landofile raw overrides.
 * @returns {import('./config/config.types').UpsunModel} Normalized model.
 */
const loadModel = (root, {overrides = {}, variables = {}} = {}) => {
  let model;
  try {
    model = load(root, {overrides, variables});
  } catch (error) {
    if (error.code === 'UPSUN_NO_CONFIG') {
      throw new Error(`No Upsun configuration found in ${root}. Expected .upsun/config.yaml (Flex) ` +
        `or .platform.app.yaml + .platform/ (Fixed). See ${DOCS}`);
    }
    if (error.code === 'UPSUN_MIXED_CONFIG' && /Magento/.test(error.message)) {
      throw new Error(`Adobe Commerce .magento configuration found alongside .upsun/ or .platform/ configuration ` +
        `in ${root}; keep only one of them. See ${DOCS}`);
    }
    if (error.code === 'UPSUN_MIXED_CONFIG') {
      throw new Error(`Both .upsun/ and .platform/ configuration found in ${root}; Upsun projects use one or ` +
        `the other. See ${DOCS}`);
    }
    throw error;
  }
  if (Object.keys(model.applications).length === 0) {
    throw new Error(`No applications defined in the Upsun configuration in ${root}. See ${DOCS}`);
  }
  return model;
};

exports.getBranch = getBranch;
exports.getClosestApp = getClosestApp;
exports.getComposerPackages = getComposerPackages;
exports.getEnvFileKeys = getEnvFileKeys;
exports.loadModel = loadModel;
