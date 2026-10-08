'use strict';

const ALIASES = Object.freeze({
  'redis-persistent': 'redis',
  'valkey-persistent': 'valkey',
  'mariadb-replica': 'mariadb',
  'postgresql-replica': 'postgresql',
  'postgres-replica': 'postgresql',
});

const registryType = type => ALIASES[type] || type;

/**
 * @param {string} type Upsun type.
 * @param {string} version Requested version, before local conversion.
 * @param {Record<string, Record<string, string>>} tags Generated pins or injected table.
 * @returns {string|undefined}
 */
const getPinnedTag = (type, version, tags = require('./upsun-registry').TAGS) =>
  tags[registryType(type)]?.[String(version)];

/**
 * @param {{kind: 'application'|'service', name: string, type: string, version: string}} target Requested image.
 * @param {Record<string, {docs: string, versions: Record<string, {status: string, eol?: string}>}>} images Registry.
 * @returns {import('../config/config.types').UpsunWarning|null}
 */
const getLifecycleWarning = (target, images = require('./upsun-registry').IMAGES) => {
  const entry = images[registryType(target.type)]?.versions[String(target.version)];
  if (!entry) return null;
  let code;
  switch (entry.status) {
    case 'deprecated': code = 'upsun-version-deprecated'; break;
    case 'retired':
    case 'decommissioned': code = 'upsun-version-retired'; break;
    default: return null;
  }
  const eol = entry.eol ? `; upstream end of life was ${entry.eol}` : '';
  return {
    code,
    message: `Upsun marks ${target.type}:${target.version} (${target.kind} "${target.name}") as ${entry.status}${eol}.`,
    data: {...target, status: entry.status, eol: entry.eol},
  };
};

exports.registryType = registryType;
exports.getPinnedTag = getPinnedTag;
exports.getLifecycleWarning = getLifecycleWarning;
