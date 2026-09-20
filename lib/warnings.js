'use strict';

const DOCS_CONFIG = 'https://docs.lando.dev/upsun/config.html';

const TITLES = {
  'composable-runtime-picked': 'Composable image reduced to a single runtime',
  'relationship-unknown-service': 'Relationship points at an unknown service',
  'runtime-unsupported': 'Unsupported Upsun runtime',
  'service-unsupported': 'Unsupported Upsun service',
  'version-fallback': 'Service version substituted',
  'version-unsupported': 'Service version not available locally',
  'redirect-route': 'Redirect route served directly',
  'varnish-vcl-ignored': 'Varnish VCL not applied locally',
  'recipe-deprecated-alias': 'Deprecated recipe name',
};

/**
 * Convert a model/mapping warning into the shape `app.addWarning` expects.
 *
 * @param {{code: string, message: string, data?: object}} warning Plugin warning.
 * @returns {{title: string, detail: string[], url: string}} Lando warning.
 */
exports.toLandoWarning = warning => ({
  title: TITLES[warning.code] || `Upsun: ${warning.code}`,
  detail: [warning.message, 'See the documentation below for more detail:'],
  url: `${DOCS_CONFIG}#${warning.code}`,
});

/**
 * Deduplicate warnings by code + message.
 *
 * @param {object[]} warnings Plugin warnings.
 * @returns {object[]} Unique warnings in first-seen order.
 */
exports.unique = (warnings = []) => {
  const seen = new Set();
  return warnings.filter(warning => {
    const key = `${warning.code}:${warning.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
