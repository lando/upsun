'use strict';

const path = require('path');

const VERSION_TABLES = require('./version-tables');
const pluginErrors = new WeakMap();

/**
 * Parses a Lando version token into comparable numeric components.
 *
 * @param {string} version Version token.
 * @returns {number[]}
 */
const parseVersion = version => String(version).trim().replace(/\.x$/i, '').split('.')
    .map(part => Number.parseInt(part, 10));

/**
 * Removes insignificant trailing zeroes from a parsed version.
 *
 * @param {number[]} parts Parsed version.
 * @returns {number[]}
 */
const normalizeParts = parts => {
  const normalized = [...parts];
  while (normalized.length > 1 && normalized.at(-1) === 0) normalized.pop();
  return normalized;
};

/**
 * Compares parsed numeric versions.
 *
 * @param {number[]} left Left version.
 * @param {number[]} right Right version.
 * @returns {number}
 */
const compareParts = (left, right) => {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
};

/**
 * Resolves an Upsun version against a bundled Lando service plugin.
 *
 * @param {string} landoType Lando service type.
 * @param {string|number} wanted Requested Upsun version.
 * @param {string[]} [supported] Caller-supplied supported versions.
 * @returns {import('./mapping.types').VersionResolution}
 */
const resolveVersion = (landoType, wanted, supported) => {
  const versions = supported?.length ? supported : VERSION_TABLES[landoType];
  if (!versions?.length) {
    throw new Error(`Unknown Lando service type: ${landoType}`);
  }

  const requested = String(wanted).trim();
  if (supported && supported.length === 0) {
    const resolved = resolveVersion(landoType, wanted);
    return {...resolved, warning: {
      code: 'plugin-outdated',
      message: `@lando/${landoType} has an empty version list; using the built-in version list.`,
      data: {landoType, wanted: requested, resolved: resolved.version},
    }};
  }
  const requestedParts = normalizeParts(parseVersion(requested));
  const literal = versions.find(version => version === requested);
  if (literal) {
    return {version: literal};
  }
  const exact = versions
      .filter(version => compareParts(normalizeParts(parseVersion(version)), requestedParts) === 0)
      .sort((left, right) => parseVersion(right).length - parseVersion(left).length)[0];
  if (exact) {
    return {version: exact};
  }

  const lower = versions
      .filter(version => parseVersion(version)[0] === requestedParts[0])
      .filter(version => compareParts(parseVersion(version), requestedParts) < 0)
      .sort((left, right) => compareParts(parseVersion(right), parseVersion(left)) ||
        parseVersion(right).length - parseVersion(left).length)[0];
  if (lower) {
    return {
      version: lower,
      warning: {
        code: 'version-fallback',
        message: `${landoType} ${requested} is unavailable; using ${lower}.`,
        data: {landoType, wanted: requested, resolved: lower},
      },
    };
  }

  const newest = [...versions].sort((left, right) => compareParts(parseVersion(right), parseVersion(left)))[0];
  return {
    version: newest,
    warning: {
      code: 'version-unsupported',
      message: `${landoType} ${requested} is unsupported; using newest available ${newest}.`,
      data: {landoType, wanted: requested, resolved: newest},
    },
  };
};

exports.VERSION_TABLES = VERSION_TABLES;
exports.resolveVersion = resolveVersion;

const VERSIONED_PLUGINS = new Set([
  'php', 'node', 'python', 'ruby', 'go', 'mariadb', 'mysql', 'postgres', 'redis', 'memcached', 'mongo', 'solr',
  'elasticsearch', 'varnish']);

/**
 * Read supported versions from installed Lando service plugins.
 * @param {Array<{name: string, dir: string}>} plugins Installed plugin metadata.
 * @returns {Record<string, string[]>} Supported versions keyed by Lando service type.
 */
const getSupportedVersions = (plugins = []) => {
  /** @type {Record<string, string[]>} */
  const versions = {};
  const errors = new Map();
  for (const plugin of plugins) {
    const match = /^@lando\/(.+)$/.exec(plugin.name || '');
    const type = match?.[1];
    if (!VERSIONED_PLUGINS.has(type)) continue;
    try {
      const builder = require(path.join(plugin.dir, 'builders', `${type}.js`));
      if (Array.isArray(builder?.config?.supported)) {
        versions[type] = [...new Set([...builder.config.supported, ...(builder.config.legacy || [])])];
      }
    } catch (error) {
      errors.set(type, error instanceof Error ? error.message : String(error));
    }
  }
  pluginErrors.set(versions, errors);
  return versions;
};

exports.getSupportedVersions = getSupportedVersions;

/**
 * Report missing or stale plugin version lists required by a project's mapped services.
 * @param {Array<{name: string, dir: string}>} plugins Installed plugin metadata.
 * @param {Set<string>|string[]} neededTypes Lando service types used locally.
 * @param {{[type: string]: string[]}} [versions] Installed versions, injectable without filesystem access.
 * @returns {import('../config/config.types').UpsunWarning[]} Plugin warnings.
 */
const getVersionTableStatus = (plugins, neededTypes, versions = getSupportedVersions(plugins)) => {
  const warnings = [];
  for (const landoType of new Set(neededTypes)) {
    if (!VERSIONED_PLUGINS.has(landoType)) continue;
    const plugin = `@lando/${landoType}`;
    const error = pluginErrors.get(versions)?.get(landoType);
    if (error) {
      warnings.push({
        code: 'plugin-unreadable',
        message: `${plugin} could not be loaded: ${error}; using the built-in version list.`,
        data: {landoType, error},
      });
    } else if (!Object.hasOwn(versions, landoType)) {
      warnings.push({
        code: 'plugin-missing',
        message: `${plugin} is not installed; using the built-in version list. Run: lando plugin-add ${plugin}`,
        data: {landoType},
      });
    } else if (!versions[landoType].includes(VERSION_TABLES[landoType][0])) {
      warnings.push({
        code: 'plugin-outdated',
        message: `${plugin} is older than the versions this plugin was built against; ` +
          `some ${landoType} versions may fall back. Run: lando plugin-add ${plugin}`,
        data: {landoType},
      });
    }
  }
  return warnings;
};

exports.VERSIONED_PLUGINS = VERSIONED_PLUGINS;
exports.getVersionTableStatus = getVersionTableStatus;
