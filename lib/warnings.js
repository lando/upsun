'use strict';

const DOCS_CONFIG = 'https://docs.lando.dev/upsun/config.html';
const CAVEATS = new Set([
  'plugin-missing', 'plugin-outdated', 'plugin-unreadable', 'upsun-version-deprecated', 'upsun-version-retired',
]);

const TITLES = {
  'composable-runtime-picked': 'Composable image reduced to a single runtime',
  'relationship-unknown-service': 'Relationship points at an unknown service',
  'relationship-unresolved': 'Relationship has no local service',
  'relationship-path-null': 'Relationship endpoint has no default database',
  'runtime-unsupported': 'Unsupported Upsun runtime',
  'service-unsupported': 'Unsupported Upsun service',
  'replica-primary-invalid': 'Replica primary missing or incompatible',
  'replica-version-mismatch': 'Replica and primary versions differ',
  'version-fallback': 'Service version substituted',
  'version-unsupported': 'Service version not available locally',
  'plugin-missing': 'Required service plugin not installed',
  'plugin-outdated': 'Service plugin version list is outdated',
  'upsun-version-deprecated': 'Upsun version deprecated',
  'upsun-version-retired': 'Upsun version retired',
  'php-extension-unsupported': 'PHP extension not available locally',
  'varnish-vcl-ignored': 'Varnish VCL not applied locally',
  'recipe-deprecated-alias': 'Deprecated recipe name',
  'solr-cores-collapsed': 'Solr cores reduced to one local core',
  'service-config-ignored': 'Service configuration not applied locally',
  'dependency-runtime-missing': 'Dependency runtime unavailable locally',
  'web-upstream-unsupported': 'Web upstream mode unavailable locally',
  'plugin-unreadable': 'Service plugin could not be loaded',
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
  url: CAVEATS.has(warning.code) ?
    `https://docs.lando.dev/upsun/caveats.html#${encodeURIComponent(warning.code)}` :
      `${DOCS_CONFIG}#${encodeURIComponent(warning.code)}`,
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
