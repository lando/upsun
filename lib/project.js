'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const LOCAL_PROJECT_PATHS = {
  flex: ['.upsun', 'local', 'project.yaml'],
  fixed: ['.platform', 'local', 'project.yaml'],
};

/**
 * Resolve the local project metadata file for a configuration flavor.
 *
 * @param {string} root Project root.
 * @param {import('./config/config.types').UpsunFlavor} flavor Configuration flavor.
 * @returns {string} Local project metadata path.
 */
const getLocalProjectFile = (root, flavor) => path.join(root, ...LOCAL_PROJECT_PATHS[flavor]);

/**
 * Read local project metadata without surfacing filesystem or YAML errors.
 *
 * @param {string} root Project root.
 * @param {import('./config/config.types').UpsunFlavor} [flavor] Configuration flavor.
 * @returns {import('./config/config.types').LocalProject|null} Local project metadata.
 */
const readLocalProject = (root, flavor) => {
  /** @type {import('./config/config.types').UpsunFlavor[]} */
  const flavors = flavor ? [flavor] : ['flex', 'fixed'];
  for (const candidate of flavors) {
    try {
      const data = /** @type {{id?: unknown, host?: unknown}|null|undefined} */ (
        yaml.load(fs.readFileSync(getLocalProjectFile(root, candidate), 'utf8')));
      const hasId = data && (typeof data.id === 'string' || typeof data.id === 'number') && String(data.id).length;
      if (hasId) return {id: String(data.id), host: typeof data.host === 'string' ? data.host : null};
    } catch (error) {
      void error;
    }
  }
  return null;
};

/**
 * Read the project ID saved by the vendor CLI.
 *
 * @param {string} root Project root.
 * @param {import('./config/config.types').UpsunFlavor} [flavor] Configuration flavor.
 * @returns {string|null} Local project ID.
 */
const readLocalProjectId = (root, flavor) => readLocalProject(root, flavor)?.id || null;

exports.getLocalProjectFile = getLocalProjectFile;
exports.readLocalProject = readLocalProject;
exports.readLocalProjectId = readLocalProjectId;
