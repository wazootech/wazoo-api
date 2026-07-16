#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { createClient } from "@libsql/client/web";

const url = required("TURSO_DATABASE_URL");
const authToken = required("TURSO_AUTH_TOKEN");
const schema = await readFile(new URL("../schema.sql", import.meta.url), "utf8");
const statements = schema
  .split(/;\s*(?:\r?\n|$)/)
  .map((sql) => sql.trim())
  .filter(Boolean);

const client = createClient({ url, authToken });
await client.batch(statements.map((sql) => ({ sql })), "write");
console.log(`Applied ${statements.length} schema statements to ${url}`);

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Set ${name}`);
    process.exit(1);
  }
  return value;
}
