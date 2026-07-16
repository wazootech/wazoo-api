#!/usr/bin/env node

const token = required("TURSO_PLATFORM_API_TOKEN");
const organization = required("TURSO_ORGANIZATION_SLUG");
const group = process.env.TURSO_GROUP || "default";
const databaseName = process.env.TURSO_CONTROL_DATABASE_NAME || "wazoo-platform-prod";

const database = await ensureDatabase(databaseName);
const hostname = database.Hostname || database.hostname;
if (!hostname) fail("Turso database response did not include Hostname");

const authToken = await createDatabaseToken(databaseName);

console.log(`TURSO_DATABASE_URL=libsql://${hostname}`);
console.log(`TURSO_AUTH_TOKEN=${authToken}`);
console.log(`TURSO_ORGANIZATION_SLUG=${organization}`);
console.log(`TURSO_GROUP=${group}`);

async function ensureDatabase(name) {
  const existing = await retrieveDatabase(name).catch(() => null);
  if (existing) return existing;

  const response = await fetch(`https://api.turso.tech/v1/organizations/${organization}/databases`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ name, group })
  });

  if (response.status === 409) return retrieveDatabase(name);
  if (!response.ok) fail(await tursoError(response));
  const body = await response.json();
  return body.database;
}

async function retrieveDatabase(name) {
  const response = await fetch(`https://api.turso.tech/v1/organizations/${organization}/databases/${name}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(await tursoError(response));
  const body = await response.json();
  return body.database;
}

async function createDatabaseToken(name) {
  const response = await fetch(`https://api.turso.tech/v1/organizations/${organization}/databases/${name}/auth/tokens?authorization=full-access`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` }
  });
  if (!response.ok) fail(await tursoError(response));
  const body = await response.json();
  if (!body.jwt) fail("Turso token response did not include jwt");
  return body.jwt;
}

async function tursoError(response) {
  const body = await response.json().catch(() => null);
  return body?.error ?? `Turso API request failed with status ${response.status}`;
}

function required(name) {
  const value = process.env[name];
  if (!value) fail(`Set ${name}`);
  return value;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
