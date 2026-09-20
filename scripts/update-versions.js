'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCES = [
  ['php', 'php', 'php.js'],
  ['node', 'node', 'node.js'],
  ['python', 'python', 'python.js'],
  ['ruby', 'ruby', 'ruby.js'],
  ['go', 'go', 'go.js'],
  ['mariadb', 'mariadb', 'mariadb.js'],
  ['mysql', 'mysql', 'mysql.js'],
  ['postgres', 'postgres', 'postgres.js'],
  ['redis', 'redis', 'redis.js'],
  ['memcached', 'memcached', 'memcached.js'],
  ['mongo', 'mongo', 'mongo.js'],
  ['solr', 'solr', 'solr.js'],
  ['elasticsearch', 'elasticsearch', 'elasticsearch.js'],
  ['varnish', 'varnish', 'varnish.js'],
];

/**
 * Extracts a string-array property, resolving a same-file const when needed.
 *
 * @param {string} source Builder source.
 * @param {string} property Property name.
 * @returns {string[]}
 */
const extractArray = (source, property) => {
  const propertyMatch = source.match(new RegExp(`${property}\\s*:\\s*(\\[|[A-Za-z_$][\\w$]*)`));
  if (!propertyMatch) return [];

  let start = propertyMatch.index + propertyMatch[0].length - propertyMatch[1].length;
  if (propertyMatch[1] !== '[') {
    const declaration = source.match(new RegExp(`const\\s+${propertyMatch[1]}\\s*=\\s*\\[`));
    if (!declaration) throw new Error(`Unable to resolve ${propertyMatch[1]}`);
    start = declaration.index + declaration[0].length - 1;
  }

  const end = source.indexOf(']', start);
  if (end === -1) throw new Error(`Unable to close ${property} array`);
  return [...source.slice(start, end + 1).matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]);
};

const constantName = type => `${type.replace(/[^a-z0-9]/gi, '_').toUpperCase()}_VERSIONS`;

const formatArray = versions => {
  const lines = [];
  let line = '  ';
  for (const version of versions) {
    const token = `'${version}',`;
    if (`${line}${token} `.length > 116) {
      lines.push(line.trimEnd());
      line = '  ';
    }
    line += `${token} `;
  }
  if (line.trim()) {
    lines.push(line.trimEnd());
  }
  return `[\n${lines.join('\n')}\n]`;
};

/**
 * Renders the generated runtime module.
 *
 * @param {Array<object>} tables Extracted version tables.
 * @param {string} date ISO generation date.
 * @returns {string}
 */
const render = (tables, date) => {
  const declarations = tables.map(({type, relative, versions}) => [
    `// generated from ${relative} on ${date}`,
    `const ${constantName(type)} = Object.freeze(${formatArray(versions)});`,
  ].join('\n')).join('\n\n');
  const entries = tables.map(({type}) => `  ${type}: ${constantName(type)},`).join('\n');

  return `'use strict';

${declarations}

const VERSION_TABLES = Object.freeze({
${entries}
});

/**
 * Parses a Lando version token into comparable numeric components.
 *
 * @param {string} version Version token.
 * @returns {number[]}
 */
const parseVersion = version => String(version).trim().replace(/\\.x$/i, '').split('.')
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
 * @returns {{version: string, warning?: object}}
 */
const resolveVersion = (landoType, wanted) => {
  const versions = VERSION_TABLES[landoType];
  if (!versions) {
    throw new Error(\`Unknown Lando service type: \${landoType}\`);
  }

  const requested = String(wanted).trim();
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
        message: \`\${landoType} \${requested} is unavailable; using \${lower}.\`,
        data: {landoType, wanted: requested, resolved: lower},
      },
    };
  }

  const newest = versions[0];
  return {
    version: newest,
    warning: {
      code: 'version-unsupported',
      message: \`\${landoType} \${requested} is unsupported; using newest available \${newest}.\`,
      data: {landoType, wanted: requested, resolved: newest},
    },
  };
};

exports.VERSION_TABLES = VERSION_TABLES;
exports.resolveVersion = resolveVersion;
`;
};

const tables = SOURCES.map(([type, plugin, file]) => {
  const relative = `../${plugin}/builders/${file}`;
  const sourcePath = path.resolve(ROOT, relative);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const versions = [...new Set([...extractArray(source, 'supported'), ...extractArray(source, 'legacy')])];
  if (versions.length === 0) {
    throw new Error(`No versions found in ${sourcePath}`);
  }
  return {type, relative, versions};
});

const date = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Chicago'}).format(new Date());
const output = path.join(ROOT, 'lib', 'mapping', 'versions.js');
fs.mkdirSync(path.dirname(output), {recursive: true});
fs.writeFileSync(output, render(tables, date));
