'use strict';

const path = require('path');
const {detect} = require('./detect');
const flex = require('./flex');
const fixed = require('./fixed');
const {normalize} = require('./normalize');

/**
 * Load a project configuration into the shared Upsun Model.
 *
 * @param {string} root Project root.
 * @returns {object} Normalized Model.
 */
const load = root => {
  const projectRoot = path.resolve(root);
  const detected = detect(projectRoot);
  const raw = detected.flavor === 'flex' ?
    flex.load(projectRoot, detected.files) : fixed.load(projectRoot, detected.files);
  return {
    flavor: detected.flavor,
    root: projectRoot,
    configFiles: detected.files,
    ...normalize(raw, detected.flavor),
  };
};

exports.detect = detect;
exports.load = load;
