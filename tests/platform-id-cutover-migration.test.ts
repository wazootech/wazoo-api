import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const fixture = readFileSync(
  join(process.cwd(), "tests/fixtures/platform-id-cutover-old-schema.sql"),
  "utf8",
);
const migration = readFileSync(
  join(process.cwd(), "migrations/2026-09-26-entity-identifiers.sql"),
  "utf8",
);

function count(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  };
  return Number(row.count);
}

describe("platform identifier cutover migration", () => {
  it("preserves rows, remaps world FKs, and leaves valid cascade behavior", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(fixture);
      const before = {
        users: count(db, "users"),
        worlds: count(db, "worlds"),
        platformTokens: count(db, "platform_api_tokens"),
        usageEvents: count(db, "usage_events"),
        worldLimits: count(db, "world_limits"),
        allowlist: count(db, "beta_allowlist"),
        auditEvents: count(db, "admin_audit_events"),
        deletionRequests: count(db, "deletion_requests"),
        rateLimits: count(db, "rate_limit_entries"),
      };

      db.exec(migration);

      expect({
        users: count(db, "users"),
        worlds: count(db, "worlds"),
        platformTokens: count(db, "platform_api_tokens"),
        usageEvents: count(db, "usage_events"),
        worldLimits: count(db, "world_limits"),
        allowlist: count(db, "beta_allowlist"),
        auditEvents: count(db, "admin_audit_events"),
        deletionRequests: count(db, "deletion_requests"),
        rateLimits: count(db, "rate_limit_entries"),
      }).toEqual(before);

      expect(
        db.prepare("SELECT user_id, email FROM users").get(),
      ).toMatchObject({
        user_id: "user_legacy_1",
        email: "legacy@example.com",
      });
      expect(
        db
          .prepare(
            "SELECT world_id, user_id, slug, display_name, stripe_customer_id, billing_state FROM worlds",
          )
          .get(),
      ).toMatchObject({
        user_id: "user_legacy_1",
        world_id: "w_canonical_1",
        slug: "legacy-world",
        display_name: "Legacy World",
        stripe_customer_id: "cus_legacy",
        billing_state: "ACTIVE",
      });
      expect(
        db
          .prepare(
            "SELECT token_id, user_id, token_hash FROM platform_api_tokens",
          )
          .get(),
      ).toMatchObject({
        token_id: "token_legacy_1",
        user_id: "user_legacy_1",
        token_hash: "hash-token-1",
      });
      expect(
        db
          .prepare(
            "SELECT event_id, user_id, world_id, quantity, provider_cost_microcents, wazoo_markup_microcents, estimated_cost_microcents FROM usage_events WHERE event_id = 'event_legacy_world'",
          )
          .get(),
      ).toMatchObject({
        event_id: "event_legacy_world",
        user_id: "user_legacy_1",
        world_id: "w_canonical_1",
        quantity: 17,
        provider_cost_microcents: 101,
        wazoo_markup_microcents: 7,
        estimated_cost_microcents: 108,
      });
      expect(
        db
          .prepare(
            "SELECT event_id, world_id, quantity FROM usage_events WHERE event_id = 'event_legacy_user'",
          )
          .get(),
      ).toMatchObject({
        event_id: "event_legacy_user",
        world_id: null,
        quantity: 3,
      });
      expect(
        db
          .prepare("SELECT world_id, metric, limit_quantity FROM world_limits")
          .get(),
      ).toMatchObject({
        world_id: "w_canonical_1",
        metric: "QUERIES",
        limit_quantity: 500,
      });
      expect(
        db
          .prepare(
            "SELECT event_id, actor_token_id, action FROM admin_audit_events",
          )
          .get(),
      ).toMatchObject({
        event_id: "audit_legacy_1",
        actor_token_id: "token_legacy_1",
        action: "worlds.create",
      });
      expect(
        db
          .prepare(
            "SELECT deletion_request_id, user_id, token_hash FROM deletion_requests",
          )
          .get(),
      ).toMatchObject({
        deletion_request_id: "request_legacy_1",
        user_id: "user_legacy_1",
        token_hash: "hash-deletion-1",
      });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

      const columnsByTable = Object.fromEntries(
        [
          "users",
          "worlds",
          "platform_api_tokens",
          "usage_events",
          "world_limits",
          "admin_audit_events",
          "deletion_requests",
        ].map((table) => [
          table,
          (
            db.prepare(`PRAGMA table_info(${table})`).all() as {
              name: string;
            }[]
          ).map((column) => column.name),
        ]),
      );
      expect(columnsByTable).toEqual({
        users: [
          "user_id",
          "email",
          "display_name",
          "state",
          "age_confirmed_at",
          "create_time",
        ],
        worlds: [
          "world_id",
          "user_id",
          "slug",
          "display_name",
          "region",
          "state",
          "billing_provider",
          "stripe_customer_id",
          "stripe_subscription_id",
          "billing_state",
          "delete_time",
          "expire_time",
          "purge_status",
          "create_time",
          "update_time",
        ],
        platform_api_tokens: [
          "token_id",
          "user_id",
          "name",
          "token_hash",
          "kind",
          "scope",
          "last_used_at",
          "expires_at",
          "create_time",
        ],
        usage_events: [
          "event_id",
          "user_id",
          "world_id",
          "metric",
          "quantity",
          "unit",
          "provider_cost_microcents",
          "wazoo_markup_microcents",
          "estimated_cost_microcents",
          "billing_source",
          "create_time",
        ],
        world_limits: [
          "world_id",
          "metric",
          "limit_quantity",
          "create_time",
          "update_time",
        ],
        admin_audit_events: [
          "event_id",
          "actor_token_id",
          "action",
          "target_resource_name",
          "outcome",
          "error_code",
          "create_time",
        ],
        deletion_requests: [
          "deletion_request_id",
          "user_id",
          "token_hash",
          "expires_at",
          "create_time",
        ],
      });

      db.prepare("DELETE FROM worlds WHERE world_id = ?").run("w_canonical_1");
      expect(
        db
          .prepare(
            "SELECT world_id FROM usage_events WHERE event_id = 'event_legacy_world'",
          )
          .get(),
      ).toEqual({ world_id: null });
      expect(count(db, "world_limits")).toBe(0);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

      db.prepare("DELETE FROM users WHERE user_id = ?").run("user_legacy_1");
      expect(count(db, "users")).toBe(0);
      expect(count(db, "worlds")).toBe(0);
      expect(count(db, "platform_api_tokens")).toBe(0);
      expect(count(db, "usage_events")).toBe(0);
      expect(count(db, "deletion_requests")).toBe(0);
      expect(count(db, "admin_audit_events")).toBe(1);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});
