'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { Client } = require('pg');
const dotenv = require('dotenv');

const TEST_DATABASE_NAME = 'love_bites_test';
const FORBIDDEN_DATABASE_NAME = 'love_bites_dev';
const MAINTENANCE_DATABASE = 'postgres';
const backendRoot = path.resolve(__dirname, '..');

function abort(message) {
  throw new Error(`Test database safety check failed: ${message}`);
}

function assertExactTestDatabase(name, action) {
  if (name === FORBIDDEN_DATABASE_NAME) {
    abort(`refusing to ${action} because the database is ${FORBIDDEN_DATABASE_NAME}`);
  }
  if (name !== TEST_DATABASE_NAME) {
    abort(`refusing to ${action} because the database is "${name}", expected "${TEST_DATABASE_NAME}"`);
  }
}

function loadEnvFile() {
  dotenv.config({ path: path.join(backendRoot, '.env') });
}

function connectionParts() {
  const user = process.env.DB_USER || 'postgres';
  const password = process.env.DB_PASSWORD || 'postgres';
  const host = process.env.DB_HOST || 'localhost';
  const port = Number(process.env.DB_PORT || 5432);
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    return { user, password, host, port };
  }

  const parsed = new URL(databaseUrl);
  return {
    user: parsed.username ? decodeURIComponent(parsed.username) : user,
    password: parsed.password ? decodeURIComponent(parsed.password) : password,
    host: parsed.hostname || host,
    port: parsed.port ? Number(parsed.port) : port
  };
}

function buildTestDatabaseUrl(parts) {
  const url = new URL(`postgres://${parts.host}:${parts.port}/${TEST_DATABASE_NAME}`);
  url.username = parts.user;
  url.password = parts.password;
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  assertExactTestDatabase(databaseName, 'build a connection URL');
  if (url.toString().includes(`/${FORBIDDEN_DATABASE_NAME}`)) {
    abort(`connection URL resolved to ${FORBIDDEN_DATABASE_NAME}`);
  }
  return url.toString();
}

function applyTestDatabaseEnvironment() {
  loadEnvFile();
  const parts = connectionParts();
  const databaseUrl = buildTestDatabaseUrl(parts);
  assertExactTestDatabase(new URL(databaseUrl).pathname.replace(/^\//, ''), 'apply the test environment');

  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
  process.env.DB_HOST = parts.host;
  process.env.DB_PORT = String(parts.port);
  process.env.DB_USER = parts.user;
  process.env.DB_PASSWORD = parts.password;
  process.env.DB_NAME = TEST_DATABASE_NAME;
  process.env.TEST_DB_NAME = TEST_DATABASE_NAME;
  process.env.DATABASE_URL = databaseUrl;
  process.env.TEST_DATABASE_URL = databaseUrl;

  return { ...parts, database: TEST_DATABASE_NAME, databaseUrl };
}

async function currentDatabase(client) {
  const result = await client.query('SELECT current_database() AS name');
  return result.rows[0].name;
}

async function withClient(database, parts, fn) {
  if (database === FORBIDDEN_DATABASE_NAME) {
    abort(`refusing to connect to ${FORBIDDEN_DATABASE_NAME}`);
  }
  const client = new Client({
    host: parts.host,
    port: parts.port,
    user: parts.user,
    password: parts.password,
    database
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function ensureTestDatabaseExists(parts) {
  await withClient(MAINTENANCE_DATABASE, parts, async (client) => {
    const connected = await currentDatabase(client);
    if (connected !== MAINTENANCE_DATABASE) {
      abort(
        `database creation must use the "${MAINTENANCE_DATABASE}" maintenance database, but current_database() is "${connected}"`
      );
    }
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DATABASE_NAME]);
    if (existing.rowCount === 0) {
      await client.query(`CREATE DATABASE ${TEST_DATABASE_NAME}`);
    }
  });
}

async function assertConnectedTestDatabase(parts, action) {
  return withClient(TEST_DATABASE_NAME, parts, async (client) => {
    const connected = await currentDatabase(client);
    assertExactTestDatabase(connected, action);
    return connected;
  });
}

function runMigrations(databaseUrl) {
  assertExactTestDatabase(new URL(databaseUrl).pathname.replace(/^\//, ''), 'run migrations');
  const cli = path.join(backendRoot, 'node_modules', 'sequelize-cli', 'lib', 'sequelize');
  const childEnv = {
    ...process.env,
    NODE_ENV: 'test',
    DB_NAME: TEST_DATABASE_NAME,
    TEST_DB_NAME: TEST_DATABASE_NAME,
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl
  };

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'db:migrate', '--env', 'test'], {
      cwd: backendRoot,
      env: childEnv,
      stdio: 'inherit'
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`sequelize-cli db:migrate --env test exited with code ${code}`));
    });
  });
}

async function prepareTestDatabase() {
  const parts = applyTestDatabaseEnvironment();
  await ensureTestDatabaseExists(parts);
  await assertConnectedTestDatabase(parts, 'run migrations');
  await runMigrations(parts.databaseUrl);
  await assertConnectedTestDatabase(parts, 'finish migrations');
  return parts;
}

module.exports = {
  TEST_DATABASE_NAME,
  FORBIDDEN_DATABASE_NAME,
  applyTestDatabaseEnvironment,
  prepareTestDatabase
};

if (require.main === module) {
  prepareTestDatabase()
    .then(() => {
      console.log(`PostgreSQL test database "${TEST_DATABASE_NAME}" is ready.`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
