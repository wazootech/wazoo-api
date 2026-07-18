import { createClient } from "@libsql/client/web";
import type { Bindings } from "../env";

export const WORLD_SCHEMA_VERSION = "1";

export type SyncReport = {
  status: "HEALTHY" | "REPAIRED" | "BLOCKED" | "FAILED";
  actions: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
  errors: Array<{ code: string; message: string }>;
};

export type ProvisioningResult = {
  databaseName: string;
  databaseUrl: string;
  syncReport: SyncReport;
};

type TursoDatabase = { Name?: string; Hostname?: string };
type DatabaseState = { database: TursoDatabase; created: boolean };

function requireTursoConfig(env: Bindings) {
  if (!env.TURSO_PLATFORM_API_TOKEN || !env.TURSO_ORGANIZATION_SLUG) {
    throw new Error("Turso provisioning is not configured");
  }
  return {
    token: env.TURSO_PLATFORM_API_TOKEN,
    organization: env.TURSO_ORGANIZATION_SLUG,
    group: env.TURSO_GROUP || "default",
  };
}

function shortHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function worldDatabaseName(env: Bindings, worldUid: string): string {
  const environment = (env.WAZOO_ENV || "dev")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-");
  const uid = worldUid.toLowerCase().replace(/_/g, "-");
  const suffix = `${environment}-${uid}`;
  if (suffix.length <= 33) return `wz-${suffix}`;
  return `wz-${environment}-${shortHash(uid)}`;
}

export async function provisionWorldDatabase(
  env: Bindings,
  worldUid: string,
  organizationUid: string,
  storedDatabaseName?: string | null,
): Promise<ProvisioningResult> {
  const databaseName = storedDatabaseName ?? worldDatabaseName(env, worldUid);
  const { database, created } = await ensureDatabase(env, databaseName);
  const databaseUrl = `libsql://${database.Hostname}`;
  const token = await createDatabaseToken(env, databaseName);
  const initialized = await initializeWorldSchema(
    databaseUrl,
    token,
    worldUid,
    organizationUid,
  );
  const repaired = created || initialized;

  return {
    databaseName,
    databaseUrl,
    syncReport: {
      status: repaired ? "REPAIRED" : "HEALTHY",
      actions: repaired
        ? [
            {
              code: "TURSO_DATABASE_READY",
              message:
                "Turso database exists and schema metadata is initialized",
            },
          ]
        : [],
      warnings: [],
      errors: [],
    },
  };
}

async function ensureDatabase(
  env: Bindings,
  databaseName: string,
): Promise<DatabaseState> {
  const config = requireTursoConfig(env);
  const existing = await retrieveDatabase(env, databaseName).catch(() => null);
  if (existing) return { database: existing, created: false };

  const response = await fetch(
    `https://api.turso.tech/v1/organizations/${config.organization}/databases`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: databaseName, group: config.group }),
    },
  );

  if (response.status === 409)
    return {
      database: await retrieveDatabase(env, databaseName),
      created: false,
    };
  if (!response.ok) throw new Error(await tursoError(response));
  const body = await response.json<{ database: TursoDatabase }>();
  if (!body.database?.Hostname)
    throw new Error("Turso database response did not include a hostname");
  return { database: body.database, created: true };
}

async function retrieveDatabase(
  env: Bindings,
  databaseName: string,
): Promise<TursoDatabase> {
  const config = requireTursoConfig(env);
  const response = await fetch(
    `https://api.turso.tech/v1/organizations/${config.organization}/databases/${databaseName}`,
    {
      headers: { authorization: `Bearer ${config.token}` },
    },
  );
  if (!response.ok) throw new Error(await tursoError(response));
  const body = await response.json<{ database: TursoDatabase }>();
  if (!body.database?.Hostname)
    throw new Error("Turso database response did not include a hostname");
  return body.database;
}

async function createDatabaseToken(
  env: Bindings,
  databaseName: string,
): Promise<string> {
  const config = requireTursoConfig(env);
  const response = await fetch(
    `https://api.turso.tech/v1/organizations/${config.organization}/databases/${databaseName}/auth/tokens?expiration=2w&authorization=full-access`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${config.token}` },
    },
  );
  if (!response.ok) throw new Error(await tursoError(response));
  const body = await response.json<{ jwt?: string }>();
  if (!body.jwt) throw new Error("Turso token response did not include a JWT");
  return body.jwt;
}

async function initializeWorldSchema(
  url: string,
  authToken: string,
  worldUid: string,
  organizationUid: string,
): Promise<boolean> {
  const client = createClient({ url, authToken });
  const metadata = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'world_metadata'",
  );
  const hadMetadata = metadata.rows.length > 0;
  if (metadata.rows.length > 0) {
    const rows = await client.execute(
      "SELECT key, value FROM world_metadata WHERE key IN ('world_uid', 'organization_uid')",
    );
    const existing = new Map(
      rows.rows.map((row) => [String(row.key), String(row.value)]),
    );
    if (
      (existing.get("world_uid") && existing.get("world_uid") !== worldUid) ||
      (existing.get("organization_uid") &&
        existing.get("organization_uid") !== organizationUid)
    ) {
      throw new Error(
        "World database identity metadata does not match control metadata",
      );
    }
  }
  await client.batch(
    [
      "CREATE TABLE IF NOT EXISTS world_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS triples (id TEXT PRIMARY KEY, subject TEXT NOT NULL, predicate TEXT NOT NULL, object TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))",
      "CREATE INDEX IF NOT EXISTS idx_triples_subject ON triples(subject)",
      "CREATE INDEX IF NOT EXISTS idx_triples_predicate ON triples(predicate)",
      "CREATE TABLE IF NOT EXISTS chunks (id TEXT PRIMARY KEY, source TEXT, text TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))",
      {
        sql: "INSERT OR REPLACE INTO world_metadata (key, value) VALUES (?, ?)",
        args: ["world_uid", worldUid],
      },
      {
        sql: "INSERT OR REPLACE INTO world_metadata (key, value) VALUES (?, ?)",
        args: ["organization_uid", organizationUid],
      },
      {
        sql: "INSERT OR REPLACE INTO world_metadata (key, value) VALUES (?, ?)",
        args: ["schema_version", WORLD_SCHEMA_VERSION],
      },
      {
        sql: "INSERT OR REPLACE INTO world_metadata (key, value) VALUES (?, ?)",
        args: ["created_by", "wazoo-api"],
      },
      {
        sql: "INSERT OR IGNORE INTO world_metadata (key, value) VALUES (?, ?)",
        args: ["create_time", new Date().toISOString()],
      },
    ],
    "write",
  );
  return !hadMetadata;
}

async function tursoError(response: Response): Promise<string> {
  const body = await response.json<{ error?: string }>().catch(() => null);
  return (
    body?.error ?? `Turso API request failed with status ${response.status}`
  );
}
