'use strict';

const path = require('path');
const _ = require('lodash');
const UpsunYaml = require('./yaml');

const mergeSection = (target, source) => _.mergeWith(target, source || {}, (_current, incoming) => {
  if (Array.isArray(incoming)) return [...incoming];
  return undefined;
});

/**
 * Load and merge first-level Flex configuration files.
 *
 * @param {string} root Project root.
 * @param {string[]} files Detected Flex files.
 * @returns {{applications: object, services: object, routes: object}}
 */
const load = (root, files) => {
  const loader = new UpsunYaml(path.join(root, '.upsun'), root);
  const result = {applications: {}, services: {}, routes: {}};
  for (const file of [...files].sort()) {
    const data = /** @type {{applications?: object, services?: object, routes?: object}} */ (loader.load(file) || {});
    mergeSection(result.applications, data.applications);
    mergeSection(result.services, data.services);
    mergeSection(result.routes, data.routes);
  }
  return result;
};

exports.load = load;
