'use strict';

const fs = require('fs');
const path = require('path');
const UpsunYaml = require('./yaml');

const sourceRoot = (root, file, app) => {
  if (file === path.join(root, '.platform', 'applications.yaml')) return app.source?.root || '';
  if (file === path.join(root, '.platform.app.yaml')) return '';
  return path.relative(root, path.dirname(file)).split(path.sep).join('/');
};

const addApplication = (applications, root, file, app) => {
  const normalized = {...app, source: {...(app.source || {}), root: sourceRoot(root, file, app)}};
  applications[normalized.name] = normalized;
};

/**
 * Load Fixed application, service, and route files into a raw configuration triple.
 *
 * @param {string} root Project root.
 * @param {string[]} files Detected Fixed files.
 * @returns {{applications: object, services: object, routes: object}}
 */
const load = (root, files) => {
  const projectRoot = path.resolve(root);
  const loader = new UpsunYaml(projectRoot);
  const applications = {};
  const applicationsFile = path.join(projectRoot, '.platform', 'applications.yaml');
  const appFiles = files.filter(file => path.basename(file) === '.platform.app.yaml' || file === applicationsFile);

  for (const file of appFiles) {
    const loaded = loader.load(file);
    for (const app of Array.isArray(loaded) ? loaded : [loaded]) addApplication(applications, projectRoot, file, app);
  }

  const servicesFile = path.join(projectRoot, '.platform', 'services.yaml');
  const routesFile = path.join(projectRoot, '.platform', 'routes.yaml');
  return {
    applications,
    services: fs.existsSync(servicesFile) ? loader.load(servicesFile) || {} : {},
    routes: fs.existsSync(routesFile) ? loader.load(routesFile) || {} : {},
  };
};

exports.load = load;
