'use strict';

const DATABASE_TYPES = Object.freeze({
  'mariadb': 'mysql',
  'mysql': 'mysql',
  'oracle-mysql': 'mysql',
  'postgresql': 'pgsql',
});

const mysqlGrant = (schema, username, privilege) => {
  const permissions = {
    admin: 'ALL PRIVILEGES',
    rw: 'SELECT, INSERT, UPDATE, DELETE, CREATE TEMPORARY TABLES, LOCK TABLES, EXECUTE',
    ro: 'SELECT',
  }[privilege];
  return permissions ? `GRANT ${permissions} ON \`${schema}\`.* TO '${username}'@'%';` : null;
};

const pgsqlGrants = (schema, username, privilege) => {
  if (privilege === 'admin') {
    return [
      `GRANT ALL PRIVILEGES ON DATABASE "${schema}" TO "${username}";`,
      `ALTER DATABASE "${schema}" OWNER TO "${username}";`,
    ];
  }
  if (privilege === 'rw') {
    return [
      `\\connect ${schema}`,
      `GRANT USAGE, CREATE ON SCHEMA public TO "${username}";`,
      `GRANT ALL ON ALL TABLES IN SCHEMA public TO "${username}";`,
      `GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "${username}";`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${username}";`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "${username}";`,
    ];
  }
  if (privilege === 'ro') {
    return [
      `\\connect ${schema}`,
      `GRANT CONNECT ON DATABASE "${schema}" TO "${username}";`,
      `GRANT USAGE ON SCHEMA public TO "${username}";`,
      `GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${username}";`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO "${username}";`,
    ];
  }
  return [];
};

const endpointEntries = (configuration, schemas) => {
  const entries = Object.entries(configuration.endpoints || {});
  if (entries.length > 0) return entries;
  return [['upsun', {privileges: Object.fromEntries(schemas.map(schema => [schema, 'admin']))}]];
};

const getMysqlStatements = (schemas, endpoints) => {
  const statements = schemas.map(schema => `CREATE DATABASE IF NOT EXISTS \`${schema}\`;`);
  for (const [username, endpoint] of endpoints) {
    statements.push(`CREATE USER IF NOT EXISTS '${username}'@'%' IDENTIFIED BY 'upsun';`);
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
    `SELECT 'CREATE DATABASE "${schema}"' WHERE NOT EXISTS ` +
    `(SELECT FROM pg_database WHERE datname = '${schema}')\\gexec`);
  for (const [username, endpoint] of endpoints) {
    const superuser = username === 'upsun' ? ' SUPERUSER' : '';
    statements.push(
        `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${username}') ` +
        `THEN CREATE ROLE "${username}" LOGIN PASSWORD 'upsun'${superuser}; END IF; END $$;`);
    for (const [schema, privilege] of Object.entries(endpoint.privileges || {})) {
      statements.push(...pgsqlGrants(schema, username, privilege));
    }
  }
  return statements;
};

const getDatabaseHost = service => {
  const dialect = DATABASE_TYPES[service.type.service];
  return dialect ? {host: service.name, dialect} : null;
};

const getDatabaseInit = service => {
  const dialect = DATABASE_TYPES[service.type.service];
  if (!dialect) return null;
  const configuration = service.configuration || {};
  const schemas = configuration.schemas ?? configuration.databases ?? ['main'];
  const endpoints = endpointEntries(configuration, schemas);
  const statements = dialect === 'mysql' ?
    getMysqlStatements(schemas, endpoints) : getPgsqlStatements(schemas, endpoints);
  return {dialect, statements};
};

exports.DATABASE_TYPES = DATABASE_TYPES;
exports.getDatabaseHost = getDatabaseHost;
exports.getDatabaseInit = getDatabaseInit;
