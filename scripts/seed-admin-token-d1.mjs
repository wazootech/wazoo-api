#!/usr/bin/env node

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const database = required("CLOUDFLARE_D1_DATABASE");
const token =
  process.env.WAZOO_PLATFORM_ADMIN_TOKEN ??
  `wzp_${randomBytes(32).toString("base64url")}`;
const name = process.env.WAZOO_PLATFORM_ADMIN_TOKEN_NAME ?? "bootstrap-admin";
const scope =
  process.env.WAZOO_PLATFORM_ADMIN_TOKEN_SCOPE ??
  "admin users.read users.write worlds.read worlds.write worlds.admin usage.read billing.read";
const hash = createHash("sha256").update(token).digest("hex");
const uid = `admin_${randomUUID()}`;
const directory = await mkdtemp(join(tmpdir(), "wazoo-admin-seed-"));
const sqlPath = join(directory, "seed.sql");

try {
  await writeFile(
    sqlPath,
    `INSERT INTO platform_api_tokens (uid, user_uid, name, token_hash, kind, scope) VALUES ('${uid}', NULL, '${escapeSql(name)}', '${hash}', 'ADMIN', '${escapeSql(scope)}');\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  const command = process.platform === "win32" ? "cmd.exe" : npx;
  const args =
    process.platform === "win32"
      ? [
          "/d",
          "/s",
          "/c",
          `${npx} wrangler d1 execute ${database} --remote --file ${sqlPath}`,
        ]
      : ["wrangler", "d1", "execute", database, "--remote", "--file", sqlPath];
  await exec(command, args, { cwd: process.cwd(), env: process.env });
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.error("Store this token securely. It will not be shown again:");
console.log(token);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}`);
  return value;
}

function escapeSql(value) {
  return value.replaceAll("'", "''");
}
