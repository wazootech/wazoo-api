#!/usr/bin/env node

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@libsql/client/web";

const url = required("TURSO_DATABASE_URL");
const authToken = required("TURSO_AUTH_TOKEN");
const token = process.env.WAZOO_PLATFORM_ADMIN_TOKEN ?? `wzp_${randomBytes(32).toString("base64url")}`;
const hash = createHash("sha256").update(token).digest("hex");
const scope = process.env.WAZOO_PLATFORM_ADMIN_TOKEN_SCOPE || "admin users.read users.write worlds.read worlds.write worlds.admin usage.read billing.read";
const name = process.env.WAZOO_PLATFORM_ADMIN_TOKEN_NAME || "bootstrap-admin";

const client = createClient({ url, authToken });
await client.execute({
  sql: "INSERT INTO platform_api_tokens (uid, user_uid, name, token_hash, kind, scope) VALUES (?, NULL, ?, ?, 'ADMIN', ?)",
  args: [`admin_${randomUUID()}`, name, hash, scope]
});

console.log("Store this token securely. It will not be shown again:");
console.log(token);

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Set ${name}`);
    process.exit(1);
  }
  return value;
}
