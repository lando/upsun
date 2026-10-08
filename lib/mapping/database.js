'use strict';

// The single source of truth for "is this a SQL service"; the mapper, pull and tooling modules
// read it instead of repeating the list. lib/env.js keeps a wider is_master list (MongoDB etc.).
const DATABASE_TYPES = Object.freeze({
  'mariadb': 'mysql',
  'mariadb-replica': 'mysql',
  'mysql': 'mysql',
  'oracle-mysql': 'mysql',
  'postgresql': 'pgsql',
  'postgres-replica': 'pgsql',
  'postgresql-replica': 'pgsql',
});

const REPLICA_TYPES = Object.freeze({
  'mariadb-replica': ['mariadb', 'mysql'],
  'postgres-replica': ['postgresql'],
  'postgresql-replica': ['postgresql'],
});

/**
 * Resolve a replica's engine-compatible primary.
 * @param {import('../config/config.types').UpsunService} service Normalized service.
 * @param {import('../config/config.types').UpsunModel} model Complete model.
 * @returns {import('../config/config.types').UpsunService|null} Valid primary, or null.
 */
const getReplicaPrimary = (service, model) => {
  const relationship = service.raw?.relationships?.primary;
  const name = typeof relationship === 'string' ? relationship.split(':')[0] : relationship?.service;
  const primary = model?.services[name];
  return primary && REPLICA_TYPES[service.type.service]?.includes(primary.type.service) ? primary : null;
};

// YAML can parse schema names such as 2024 as numbers.
const mysqlIdentifier = value => `\`${String(value).replace(/`/g, '``')}\``;
const mysqlLiteral = value => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, '\'\'')}'`;
// GRANT database names are patterns: `\`, `_` and `%` need a backslash to match literally.
const mysqlGrantSchema = value => mysqlIdentifier(String(value).replace(/[\\_%]/g, '\\$&'));
const pgsqlIdentifier = value => `"${String(value).replace(/"/g, '""')}"`;
const pgsqlLiteral = value => `'${String(value).replace(/'/g, '\'\'')}'`;

const mysqlGrant = (schema, username, privilege) => {
  const permissions = {
    admin: 'ALL PRIVILEGES',
    rw: 'SELECT, INSERT, UPDATE, DELETE, CREATE TEMPORARY TABLES, LOCK TABLES, EXECUTE, ' +
      'SHOW VIEW, EVENT, INDEX, TRIGGER',
    ro: 'SELECT, SHOW VIEW, CREATE TEMPORARY TABLES',
  }[privilege];
  return permissions ? `GRANT ${permissions} ON ${mysqlGrantSchema(schema)}.* TO ${mysqlLiteral(username)}@'%';` : null;
};

const pgsqlGrants = (rawSchema, rawUsername, privilege, owners) => {
  const schema = pgsqlIdentifier(rawSchema);
  const username = pgsqlIdentifier(rawUsername);
  if (privilege === 'admin') {
    return [
      `GRANT ALL PRIVILEGES ON DATABASE ${schema} TO ${username};`,
      `ALTER DATABASE ${schema} OWNER TO ${username};`,
    ];
  }
  if (privilege === 'rw' || privilege === 'ro') {
    const tables = privilege === 'rw' ? 'SELECT, INSERT, UPDATE, DELETE' : 'SELECT';
    const sequences = privilege === 'rw' ? 'USAGE, SELECT, UPDATE' : 'SELECT';
    return [
      `\\connect ${schema}`,
      `REVOKE ALL ON SCHEMA public FROM ${username};`,
      `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${username};`,
      `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${username};`,
      `GRANT CONNECT ON DATABASE ${schema} TO ${username};`,
      `GRANT USAGE ON SCHEMA public TO ${username};`,
      `GRANT ${tables} ON ALL TABLES IN SCHEMA public TO ${username};`,
      `GRANT ${sequences} ON ALL SEQUENCES IN SCHEMA public TO ${username};`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ${username};`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${username};`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ${tables} ON TABLES TO ${username};`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ${sequences} ON SEQUENCES TO ${username};`,
      ...owners.flatMap(owner => [
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${pgsqlIdentifier(owner)} IN SCHEMA public ` +
          `REVOKE ALL ON TABLES FROM ${username};`,
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${pgsqlIdentifier(owner)} IN SCHEMA public ` +
          `REVOKE ALL ON SEQUENCES FROM ${username};`,
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${pgsqlIdentifier(owner)} IN SCHEMA public ` +
          `GRANT ${tables} ON TABLES TO ${username};`,
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${pgsqlIdentifier(owner)} IN SCHEMA public ` +
          `GRANT ${sequences} ON SEQUENCES TO ${username};`,
      ]),
    ];
  }
  return [];
};

const endpointEntries = (configuration, schemas) => {
  const entries = Object.entries(configuration.endpoints || {});
  if (entries.length > 0) return entries.map(([name, endpoint]) => [name, {...endpoint, synthetic: false}]);
  return [['upsun', {synthetic: true, privileges: Object.fromEntries(schemas.map(schema => [schema, 'admin']))}]];
};

const getMysqlStatements = (schemas, endpoints) => {
  const statements = schemas.map(schema => `CREATE DATABASE IF NOT EXISTS ${mysqlIdentifier(schema)};`);
  for (const [username, endpoint] of endpoints) {
    statements.push(`CREATE USER IF NOT EXISTS ${mysqlLiteral(username)}@'%' IDENTIFIED BY 'upsun';`);
    statements.push(`REVOKE ALL PRIVILEGES, GRANT OPTION FROM ${mysqlLiteral(username)}@'%';`);
    for (const [schema, privilege] of Object.entries(endpoint.privileges || {})) {
      const grant = mysqlGrant(schema, username, privilege);
      if (grant) statements.push(grant);
    }
  }
  statements.push('FLUSH PRIVILEGES;');
  return statements;
};

const getPgsqlStatements = (schemas, endpoints) => {
  const statements = schemas.map(schema =>
    `SELECT format('CREATE DATABASE %I', ${pgsqlLiteral(schema)}) WHERE NOT EXISTS ` +
    `(SELECT FROM pg_database WHERE datname = ${pgsqlLiteral(schema)})\\gexec`);
  for (const [username, endpoint] of endpoints) {
    const superuser = endpoint.synthetic === true ? ' SUPERUSER' : '';
    statements.push(
        `SELECT format('CREATE ROLE %I LOGIN PASSWORD %L${superuser}', ${pgsqlLiteral(username)}, 'upsun') ` +
        `WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = ${pgsqlLiteral(username)})\\gexec`);
  }
  for (const [username, endpoint] of endpoints) {
    for (const [schema, privilege] of Object.entries(endpoint.privileges || {})) {
      const owners = endpoints.filter(([, entry]) => ['admin', 'rw'].includes(entry.privileges?.[schema]))
          .map(([owner]) => owner);
      statements.push(...pgsqlGrants(schema, username, privilege, owners));
    }
  }
  return statements;
};

/**
 * Resolve a SQL service's local host and dialect.
 * @param {import('../config/config.types').UpsunService} service Normalized service.
 * @param {import('../config/config.types').UpsunModel} [model] Complete model (required for replicas).
 * @returns {{host: string, dialect: string}|null} SQL connection target.
 */
const getDatabaseHost = (service, model) => {
  const dialect = DATABASE_TYPES[service.type.service];
  if (REPLICA_TYPES[service.type.service]) {
    const primary = getReplicaPrimary(service, model);
    return primary ? {host: primary.name, dialect} : null;
  }
  return dialect ? {host: service.name, dialect} : null;
};

/**
 * Build initialization statements for a SQL service.
 * @param {import('../config/config.types').UpsunService} service Normalized service.
 * @param {import('../config/config.types').UpsunModel} [model] Complete model (required for replicas).
 * @returns {import('./mapping.types').DatabaseInit|null} SQL initialization, or null for other services.
 */
const getDatabaseInit = (service, model) => {
  const dialect = DATABASE_TYPES[service.type.service];
  if (!dialect) return null;
  const configuration = service.configuration || {};
  if (REPLICA_TYPES[service.type.service]) {
    const primary = getReplicaPrimary(service, model);
    if (!primary) return null;
    const primaryConfig = primary.configuration || {};
    const schemas = configuration.schemas ?? configuration.databases ??
      primaryConfig.schemas ?? primaryConfig.databases ?? ['main'];
    const configured = Object.entries(configuration.endpoints || {});
    const endpoints = configured.length ? configured :
      Object.entries({[dialect === 'mysql' ? 'mysql' : 'postgresql']: {privileges: {}}});
    const statements = [];
    for (const [name, endpoint] of endpoints) {
      const username = `${service.name}_${name}`;
      if (dialect === 'mysql') {
        statements.push(`CREATE USER IF NOT EXISTS ${mysqlLiteral(username)}@'%' IDENTIFIED BY 'upsun';`);
        statements.push(`REVOKE ALL PRIVILEGES, GRANT OPTION FROM ${mysqlLiteral(username)}@'%';`);
        const privileges = Object.entries(endpoint.privileges || {});
        const readable = privileges.length ? privileges.filter(([, level]) => level !== 'replication')
            .map(([schema]) => schema) : schemas;
        for (const schema of readable) statements.push(mysqlGrant(schema, username, 'ro'));
      } else {
        statements.push(
            `SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', ${pgsqlLiteral(username)}, 'upsun') ` +
            `WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = ${pgsqlLiteral(username)})\\gexec`,
            `ALTER ROLE ${pgsqlIdentifier(username)} SET default_transaction_read_only = on;`);
        const roles = endpointEntries(primaryConfig, schemas).filter(([, entry]) =>
          entry.replication !== true && !Object.values(entry.privileges || {}).includes('replication'));
        for (const [role] of roles) {
          statements.push(`GRANT ${pgsqlIdentifier(role)} TO ${pgsqlIdentifier(username)};`);
        }
      }
    }
    if (dialect === 'mysql') statements.push('FLUSH PRIVILEGES;');
    return {dialect, statements};
  }
  const schemas = configuration.schemas ?? configuration.databases ?? ['main'];
  const endpoints = endpointEntries(configuration, schemas);
  const statements = dialect === 'mysql' ?
    getMysqlStatements(schemas, endpoints) : getPgsqlStatements(schemas, endpoints);
  return {dialect, statements};
};

exports.DATABASE_TYPES = DATABASE_TYPES;
exports.REPLICA_TYPES = REPLICA_TYPES;
exports.getReplicaPrimary = getReplicaPrimary;
exports.getDatabaseHost = getDatabaseHost;
exports.getDatabaseInit = getDatabaseInit;
