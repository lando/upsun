'use strict';

const path = require('path');
const _ = require('lodash');
const {detect} = require('./detect');
const flex = require('./flex');
const fixed = require('./fixed');
const {normalize} = require('./normalize');

/**
 * Load a project configuration into the shared Upsun Model.
 * Merge local variables, then overrides, into existing raw targets before normalization.
 * Lodash merge semantics include merging arrays by index; caller options are not mutated.
 *
 * @param {string} root Project root.
 * @param {import('./config.types').ConfigLoadOptions} [options] Local raw configuration overrides.
 * @returns {import('./config.types').UpsunModel} Normalized Model.
 */
const load = (root, {overrides = {}, variables = {}} = {}) => {
  const projectRoot = path.resolve(root);
  const detected = detect(projectRoot);
  const raw = detected.flavor === 'flex' ?
    flex.load(projectRoot, detected.files) : fixed.load(projectRoot, detected.files, {
      appFile: `.${detected.layout}.app.yaml`, dir: `.${detected.layout}`,
    });
  for (const [name, application] of Object.entries(raw.applications)) {
    const legacy = Object.hasOwn(variables, name) ? {variables: variables[name]} : {};
    const override = Object.hasOwn(overrides, name) ? overrides[name] : {};
    raw.applications[name] = _.merge({}, application, legacy, override);
  }
  for (const [name, service] of Object.entries(raw.services)) {
    if (Object.hasOwn(overrides, name)) raw.services[name] = _.merge({}, service, overrides[name]);
  }
  return {
    flavor: detected.flavor,
    layout: detected.layout,
    root: projectRoot,
    configFiles: detected.files,
    ...normalize(raw, detected.flavor),
  };
};

exports.detect = detect;
exports.load = load;
