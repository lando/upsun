'use strict';

const fs = require('fs');
const path = require('path');
const UpsunYaml = require('./yaml');

const sourceRoot = (root, file, app, layout) => {
  if (file === path.join(root, layout.dir, 'applications.yaml')) return app.source?.root || '';
  if (file === path.join(root, layout.appFile)) return '';
  return path.relative(root, path.dirname(file)).split(path.sep).join('/');
};

const addApplication = (applications, root, file, app, layout) => {
  const normalized = {...app, source: {...(app.source || {}), root: sourceRoot(root, file, app, layout)}};
  applications[normalized.name] = normalized;
};

/**
 * Load Fixed application, service, and route files into a raw configuration triple.
 *
 * @param {string} root Project root.
 * @param {string[]} files Detected Fixed files.
 * @param {{appFile: string, dir: string}} layout Fixed configuration file names.
 * @returns {{applications: object, services: object, routes: object}}
 */
const load = (root, files, layout = {appFile: '.platform.app.yaml', dir: '.platform'}) => {
  const projectRoot = path.resolve(root);
  const loader = new UpsunYaml(projectRoot);
  const applications = {};
  const applicationsFile = path.join(projectRoot, layout.dir, 'applications.yaml');
  const appFiles = files.filter(file => path.basename(file) === layout.appFile || file === applicationsFile);

  for (const file of appFiles) {
    const loaded = loader.load(file);
    for (const app of Array.isArray(loaded) ? loaded : [loaded]) {
      addApplication(applications, projectRoot, file, app, layout);
    }
  }

  const servicesFile = path.join(projectRoot, layout.dir, 'services.yaml');
  const routesFile = path.join(projectRoot, layout.dir, 'routes.yaml');
  return {
    applications,
    services: fs.existsSync(servicesFile) ? loader.load(servicesFile) || {} : {},
    routes: fs.existsSync(routesFile) ? loader.load(routesFile) || {} : {},
  };
};

exports.load = load;
