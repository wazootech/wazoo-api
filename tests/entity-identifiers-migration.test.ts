import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const oldSchema = readFileSync(
  resolve(directory, "fixtures/entity-identifiers-before.sql"),
  "utf8",
);
const migration = readFileSync(
  resolve(directory, "../migrations/2026-09-26-entity-identifiers.sql"),
  "utf8",
);

describe("entity identifier migration", () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = new DatabaseSync(":memory:");
    database.exec(oldSchema);

    database
      .prepare(
        "INSERT INTO users (uid, email, display_name, state, create_time) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        "user-before",
        "before@example.com",
        "Before",
        "active",
        "2026-09-01T00:00:00Z",
      );

    database
      .prepare(
        "INSERT INTO worlds (uid, user_uid, world_id, slug, worlds_api_uid, display_name, state, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "world-row-a",
        "user-before",
        "w_canonical_a",
        "alpha",
        "w_canonical_a",
        "Alpha",
        "active",
        "2026-09-01T00:00:00Z",
        "2026-09-01T00:00:00Z",
      );
    database
      .prepare(
        "INSERT INTO worlds (uid, user_uid, world_id, slug, worlds_api_uid, display_name, state, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "world-row-b",
        "user-before",
        "w_canonical_b",
        "beta",
        null,
        "Beta",
        "active",
        "2026-09-02T00:00:00Z",
        "2026-09-02T00:00:00Z",
      );

    database
      .prepare(
        "INSERT INTO platform_api_tokens (uid, user_uid, name, token_hash, kind, scope) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        "token-before",
        "user-before",
        "personal",
        "hash-user",
        "USER",
        "users.read",
      );
    database
      .prepare(
        "INSERT INTO platform_api_tokens (uid, user_uid, name, token_hash, kind, scope) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("admin-before", null, "admin", "hash-admin", "ADMIN", "admin");

    database
      .prepare(
        "INSERT INTO usage_events (uid, user_uid, world_uid, metric, quantity, unit, provider_cost_microcents, wazoo_markup_microcents, estimated_cost_microcents, billing_source, create_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "usage-before",
        "user-before",
        "world-row-a",
        "SPARQL_QUERIES",
        7,
        "count",
        100,
        10,
        110,
        "BETA_FREE",
        "2026-09-03T00:00:00Z",
      );
    database
      .prepare(
        "INSERT INTO usage_events (uid, user_uid, world_uid, metric, quantity, unit, create_time) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "usage-without-world",
        "user-before",
        null,
        "IMPORTS",
        2,
        "count",
        "2026-09-04T00:00:00Z",
      );
    database
      .prepare(
        "INSERT INTO world_limits (world_uid, metric, limit_quantity, create_time, update_time) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        "world-row-a",
        "SPARQL_QUERIES",
        20,
        "2026-09-01T00:00:00Z",
        "2026-09-02T00:00:00Z",
      );
    database
      .prepare(
        "INSERT INTO deletion_requests (uid, user_uid, token_hash, expires_at, create_time) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        "deletion-before",
        "user-before",
        "delete-hash",
        "2026-09-05T00:00:00Z",
        "2026-09-04T00:00:00Z",
      );
    database
      .prepare(
        "INSERT INTO admin_audit_events (uid, actor_token_uid, action, target_resource_name, outcome, create_time) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        "audit-before",
        "token-before",
        "world.create",
        "worlds/w_canonical_a",
        "SUCCESS",
        "2026-09-05T00:00:00Z",
      );
  });

  afterEach(() => database.close());

  it("preserves entity IDs, values, and world relationships without foreign-key violations", () => {
    database.exec(migration);

    expect(database.prepare("SELECT user_id, email FROM users").all()).toEqual([
      { user_id: "user-before", email: "before@example.com" },
    ]);
    expect(
      database
        .prepare(
          "SELECT world_id, user_id, slug, display_name, region, state, billing_state, create_time, update_time FROM worlds ORDER BY world_id",
        )
        .all(),
    ).toEqual([
      {
        world_id: "w_canonical_a",
        user_id: "user-before",
        slug: "alpha",
        display_name: "Alpha",
        region: "auto",
        state: "active",
        billing_state: "BETA_FREE",
        create_time: "2026-09-01T00:00:00Z",
        update_time: "2026-09-01T00:00:00Z",
      },
      {
        world_id: "w_canonical_b",
        user_id: "user-before",
        slug: "beta",
        display_name: "Beta",
        region: "auto",
        state: "active",
        billing_state: "BETA_FREE",
        create_time: "2026-09-02T00:00:00Z",
        update_time: "2026-09-02T00:00:00Z",
      },
    ]);
    expect(
      database
        .prepare(
          "SELECT event_id, user_id, world_id, metric, quantity, unit, provider_cost_microcents, wazoo_markup_microcents, estimated_cost_microcents, billing_source, create_time FROM usage_events ORDER BY event_id",
        )
        .all(),
    ).toEqual([
      {
        event_id: "usage-before",
        user_id: "user-before",
        world_id: "w_canonical_a",
        metric: "SPARQL_QUERIES",
        quantity: 7,
        unit: "count",
        provider_cost_microcents: 100,
        wazoo_markup_microcents: 10,
        estimated_cost_microcents: 110,
        billing_source: "BETA_FREE",
        create_time: "2026-09-03T00:00:00Z",
      },
      {
        event_id: "usage-without-world",
        user_id: "user-before",
        world_id: null,
        metric: "IMPORTS",
        quantity: 2,
        unit: "count",
        provider_cost_microcents: null,
        wazoo_markup_microcents: 0,
        estimated_cost_microcents: null,
        billing_source: "BETA_FREE",
        create_time: "2026-09-04T00:00:00Z",
      },
    ]);
    expect(
      database
        .prepare(
          "SELECT world_id, metric, limit_quantity, create_time, update_time FROM world_limits",
        )
        .all(),
    ).toEqual([
      {
        world_id: "w_canonical_a",
        metric: "SPARQL_QUERIES",
        limit_quantity: 20,
        create_time: "2026-09-01T00:00:00Z",
        update_time: "2026-09-02T00:00:00Z",
      },
    ]);
    expect(
      database
        .prepare(
          "SELECT token_id, user_id, name, token_hash, kind, scope FROM platform_api_tokens ORDER BY token_id",
        )
        .all(),
    ).toEqual([
      {
        token_id: "admin-before",
        user_id: null,
        name: "admin",
        token_hash: "hash-admin",
        kind: "ADMIN",
        scope: "admin",
      },
      {
        token_id: "token-before",
        user_id: "user-before",
        name: "personal",
        token_hash: "hash-user",
        kind: "USER",
        scope: "users.read",
      },
    ]);
    expect(
      database
        .prepare(
          "SELECT deletion_request_id, user_id, token_hash, expires_at, create_time FROM deletion_requests",
        )
        .all(),
    ).toEqual([
      {
        deletion_request_id: "deletion-before",
        user_id: "user-before",
        token_hash: "delete-hash",
        expires_at: "2026-09-05T00:00:00Z",
        create_time: "2026-09-04T00:00:00Z",
      },
    ]);
    expect(
      database
        .prepare(
          "SELECT event_id, actor_token_id, action, target_resource_name, outcome, create_time FROM admin_audit_events",
        )
        .all(),
    ).toEqual([
      {
        event_id: "audit-before",
        actor_token_id: "token-before",
        action: "world.create",
        target_resource_name: "worlds/w_canonical_a",
        outcome: "SUCCESS",
        create_time: "2026-09-05T00:00:00Z",
      },
    ]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
