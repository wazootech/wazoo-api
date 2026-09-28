import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const reset = readFileSync(
  join(process.cwd(), "migrations/2026-09-27-platform-id-clean-reset.sql"),
  "utf8",
);
const schema = readFileSync(join(process.cwd(), "schema.sql"), "utf8");
const tables = [
  "users",
  "worlds",
  "platform_api_tokens",
  "usage_events",
  "world_limits",
  "beta_allowlist",
  "admin_audit_events",
  "deletion_requests",
  "rate_limit_entries",
];
const primaryKeysByTable = {
  users: "user_id",
  worlds: "world_id",
  platform_api_tokens: "token_id",
  usage_events: "event_id",
  world_limits: "world_limit_id",
  beta_allowlist: "beta_allowlist_id",
  admin_audit_events: "event_id",
  deletion_requests: "request_id",
  rate_limit_entries: "rate_limit_entry_id",
} as const;
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function database() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  return db;
}

function count(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  };
  return Number(row.count);
}

function columns(db: DatabaseSync, table: string): string[] {
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  ).map((column) => column.name);
}

describe("platform clean reset", () => {
  it("drops all platform records and rebuilds the canonical empty schema", () => {
    const db = database();
    db.exec(schema);
    db.prepare("INSERT INTO users (user_id, email) VALUES (?, ?)").run(
      "user-test",
      "test@example.com",
    );
    db.prepare(
      "INSERT INTO worlds (world_id, user_id, display_name) VALUES (?, ?, ?)",
    ).run("w_00000000-0000-4000-8000-000000000001", "user-test", "Test world");
    db.prepare(
      "INSERT INTO platform_api_tokens (token_id, user_id, name, token_hash) VALUES (?, ?, ?, ?)",
    ).run("token-test", "user-test", "test token", "hash-token");
    db.prepare(
      "INSERT INTO usage_events (event_id, user_id, metric, quantity) VALUES (?, ?, ?, ?)",
    ).run("event-test", "user-test", "QUERIES", 1);
    db.prepare(
      "INSERT INTO world_limits (world_id, metric, limit_quantity) VALUES (?, ?, ?)",
    ).run("w_00000000-0000-4000-8000-000000000001", "QUERIES", 10);
    db.prepare("INSERT INTO beta_allowlist (email) VALUES (?)").run(
      "test@example.com",
    );
    db.prepare(
      "INSERT INTO admin_audit_events (event_id, action, target_resource_name, outcome) VALUES (?, ?, ?, ?)",
    ).run(
      "audit-test",
      "test.action",
      "worlds/w_00000000-0000-4000-8000-000000000001",
      "SUCCESS",
    );
    db.prepare(
      "INSERT INTO deletion_requests (request_id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
    ).run("deletion-test", "user-test", "hash-deletion", "2030-01-01");
    db.prepare(
      "INSERT INTO rate_limit_entries (key, count, reset_at_ms) VALUES (?, ?, ?)",
    ).run("rate-test", 1, 1);

    db.exec(reset);
    db.exec(schema);

    for (const table of tables) {
      expect(count(db, table)).toBe(0);
      const primaryKeys = (
        db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
          name: string;
          pk: number;
        }>
      ).filter((column) => column.pk > 0);
      expect(primaryKeys).toHaveLength(1);
      expect(primaryKeys[0].name).toBe(
        primaryKeysByTable[table as keyof typeof primaryKeysByTable],
      );
    }
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    const worldInfo = db.prepare("PRAGMA table_info(worlds)").all() as Array<{
      name: string;
      pk: number;
    }>;
    expect(worldInfo.find((column) => column.name === "world_id")?.pk).toBe(1);
    expect(columns(db, "worlds")).not.toContain("slug");
    expect(columns(db, "admin_audit_events")).toContain("actor_token_id");
    expect(columns(db, "admin_audit_events")).not.toContain(
      "actor_platform_api_token_id",
    );

    const canonical = database();
    canonical.exec(schema);
    for (const table of tables) {
      expect(columns(db, table)).toEqual(columns(canonical, table));
    }
  });

  it("can repeat the reset if schema initialization must be retried", () => {
    const db = database();
    db.exec(schema);
    db.prepare("INSERT INTO users (user_id, email) VALUES (?, ?)").run(
      "user-test",
      "test@example.com",
    );

    db.exec(reset);
    db.exec(reset);
    db.exec(schema);

    for (const table of tables) expect(count(db, table)).toBe(0);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
