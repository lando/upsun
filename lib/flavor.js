'use strict';

const fs = require('fs');
const path = require('path');

const FLEX_MESSAGE = [
  'Flex unsupported until Phase 3; Fixed-only.',
  'Found .upsun/config.yaml.',
  'This plugin only loads Fixed config: .platform.app.yaml and .platform/{routes,services,applications}.yaml.',
  'An empty .upsun/ directory is ignored; Flex begins only when .upsun/config.yaml is present.',
].join(' ');

/**
 * Flex is defined as `.upsun/config.yaml` present. An empty `.upsun/` dir is not Flex.
 *
 * @param {string} baseDir Project root.
 * @return {boolean}
 */
exports.isFlex = baseDir => fs.existsSync(path.join(baseDir, '.upsun', 'config.yaml'));

/**
 * Error thrown when Flex config is present.
 *
 * @return {Error}
 */
exports.flexUnsupportedError = () => {
  const err = new Error(FLEX_MESSAGE);
  err.code = 'UPSUN_FLEX_UNSUPPORTED';
  return err;
};

/**
 * Throw if this project is Flex.
 *
 * @param {string} baseDir Project root.
 */
exports.assertFixedOnly = baseDir => {
  if (exports.isFlex(baseDir)) {
    throw exports.flexUnsupportedError();
  }
};

exports.FLEX_MESSAGE = FLEX_MESSAGE;
