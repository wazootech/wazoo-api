import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app from "../src/index";
import type { Bindings } from "../src/env";

const ADMIN_TOKEN = "wzp_test-admin-token";
const TEST_EMAIL = "quota-user@example.com";

function makeBindings(dbPath: string): Bindings {
  return {
    TURSO_DATABASE_URL: `file:${dbPath}`,
    TURSO_AUTH_TOKEN: "",
    WORLDS_API_URL: "http://localhost:9999",
    WORLDS_API_ADMIN_KEY: "test",
    WAZOO_PLATFORM_ADMIN_TOKEN: ADMIN_TOKEN,
    WAZOO_ENV: "test",
  };
}

const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

function api(
  path: string,
  init: RequestInit,
  env: Bindings,
): Promise<Response> {
  return Promise.resolve(app.request(path, init, env, executionCtx));
}

function authHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

interface LimitSummary {
  metric: string;
  quantity: number;
  limitQuantity: number;
  usagePercent: number;
}

interface QuotaSummary {
  state: "OK" | "WARN" | "THROTTLED";
  usagePercent: number;
  limits: LimitSummary[];
}

describe("quota payloads on usage and billing surfaces (wazoo-api#34)", () => {
  let dir: string;
  let env: Bindings;
  let sessionToken: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "wazoo-api-quota-payloads-"));
    const dbPath = join(dir, "test.db");
    const client = createClient({ url: `file:${dbPath}` });
    await client.executeMultiple(
      readFileSync(join(process.cwd(), "schema.sql"), "utf8"),
    );
    await client.close();
    env = makeBindings(dbPath);

    const sessionRes = await api(
      "/v1/auth/workos-session",
      {
        method: "POST",
        headers: authHeaders(ADMIN_TOKEN),
        body: JSON.stringify({
          email: TEST_EMAIL,
          displayName: "Quota User",
          ageConfirmed: true,
        }),
      },
      env,
    );
    expect(sessionRes.status).toBe(201);
    sessionToken = ((await sessionRes.json()) as { token: string }).token;

    const me = await api(
      "/v1/users/me",
      { headers: authHeaders(sessionToken) },
      env,
    );
    const userUid = ((await me.json()) as { user: { uid: string } }).user.uid;

    const seed = createClient({ url: `file:${dbPath}` });
    const ts = new Date().toISOString();
    await seed.execute({
      sql: "INSERT INTO worlds (uid, user_uid, world_id, display_name, state, billing_state, create_time, update_time) VALUES (?, ?, ?, ?, 'active', 'BETA_FREE', ?, ?)",
      args: ["w_quota_1", userUid, "quota-world", "Quota World", ts, ts],
    });
    await seed.execute({
      sql: "INSERT INTO worlds (uid, user_uid, world_id, display_name, state, billing_state, create_time, update_time) VALUES (?, ?, ?, ?, 'active', 'PAST_DUE', ?, ?)",
      args: ["w_quota_2", userUid, "due-world", "Due World", ts, ts],
    });
    await seed.execute({
      sql: "INSERT INTO world_limits (world_uid, metric, limit_quantity, create_time, update_time) VALUES (?, ?, ?, ?, ?)",
      args: ["w_quota_1", "SPARQL_QUERIES", 10000, ts, ts],
    });
    for (let i = 0; i < 92; i++) {
      await seed.execute({
        sql: "INSERT INTO usage_events (uid, user_uid, world_uid, metric, quantity, unit, create_time) VALUES (?, ?, ?, 'SPARQL_QUERIES', 100, 'count', ?)",
        args: [`usage_${i}`, userUid, "w_quota_1", ts],
      });
    }
    await seed.close();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    try {
      rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    } catch {
      // Best-effort cleanup of the temp directory.
    }
  });

  it("usage response includes per-metric limits with real usage percent", async () => {
    const res = await api(
      "/v1/worlds/quota-world/usage",
      { headers: authHeaders(sessionToken) },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      usage: { total: Array<{ metric: string; quantity: number }> };
      quota: QuotaSummary;
    };
    expect(body.usage.total).toEqual([
      { metric: "SPARQL_QUERIES", quantity: 9200 },
    ]);
    expect(body.quota.limits).toEqual([
      {
        metric: "SPARQL_QUERIES",
        quantity: 9200,
        limitQuantity: 10000,
        usagePercent: 92,
      },
    ]);
    expect(body.quota.usagePercent).toBe(92);
    expect(body.quota.state).toBe("WARN");
  });

  it("usage response without limits reports an empty, OK quota", async () => {
    const res = await api(
      "/v1/worlds/due-world/usage",
      { headers: authHeaders(sessionToken) },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { quota: QuotaSummary };
    expect(body.quota.limits).toEqual([]);
    expect(body.quota.usagePercent).toBe(0);
    expect(body.quota.state).toBe("OK");
  });

  it("billing response includes plan caps and derives paymentRequired from state", async () => {
    const res = await api(
      "/v1/worlds/quota-world/billing",
      { headers: authHeaders(sessionToken) },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      billing: { paymentRequired: boolean };
      quota: QuotaSummary;
    };
    expect(body.billing.paymentRequired).toBe(false);
    // Two active worlds (quota-world + due-world) against the 10-world cap.
    expect(body.quota.limits).toContainEqual({
      metric: "MAX_WORLDS",
      quantity: 2,
      limitQuantity: 10,
      usagePercent: 20,
    });
    expect(body.quota.limits).toContainEqual({
      metric: "SPARQL_QUERIES",
      quantity: 9200,
      limitQuantity: 10000,
      usagePercent: 92,
    });
    // The worst limit drives the summary: SPARQL_QUERIES at 92%.
    expect(body.quota.usagePercent).toBe(92);
    expect(body.quota.state).toBe("WARN");
  });

  it("billing paymentRequired is true for a past-due world", async () => {
    const res = await api(
      "/v1/worlds/due-world/billing",
      { headers: authHeaders(sessionToken) },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      billing: { paymentRequired: boolean };
    };
    expect(body.billing.paymentRequired).toBe(true);
  });
});
