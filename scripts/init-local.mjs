#!/usr/bin/env node
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@libsql/client";

const DB_PATH = process.env.DB_PATH ?? "file:control-plane.db";
const ADMIN_TOKEN = process.env.WAZOO_PLATFORM_ADMIN_TOKEN ?? `wzp_${randomBytes(32).toString("base64url")}`;

console.log(`Initializing local SQLite database at ${DB_PATH}`);

const client = createClient({ url: DB_PATH });

const schema = await readFile(new URL("../schema.sql", import.meta.url), "utf8");
const statements = schema
  .split(/;\s*(?:\r?\n|$)/)
  .map((sql) => sql.trim())
  .filter(Boolean);

await client.batch(statements.map((sql) => ({ sql })), "write");
console.log(`Applied ${statements.length} schema statements`);

const hash = createHash("sha256").update(ADMIN_TOKEN).digest("hex");
const scope = "admin users.read users.write worlds.read worlds.write worlds.admin usage.read billing.read";
await client.execute({
  sql: "INSERT INTO platform_api_tokens (uid, user_uid, name, token_hash, kind, scope) VALUES (?, NULL, ?, ?, 'ADMIN', ?)",
  args: [`admin_${randomUUID()}`, "local-admin", hash, scope],
});

await client.execute({
  sql: "INSERT OR IGNORE INTO users (uid, email, display_name) VALUES (?, ?, ?)",
  args: ["user_admin", "admin@wazoo.dev", "Admin"],
});

console.log("\nAdmin token generated:");
console.log(ADMIN_TOKEN);
console.log("\nStore this token in .dev.vars as WAZOO_PLATFORM_ADMIN_TOKEN");

await client.close();
