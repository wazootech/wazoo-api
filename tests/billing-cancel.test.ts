import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app from "../src/index";
import type { Bindings } from "../src/env";

const ADMIN_TOKEN = "wzp_test-admin-token";
const TEST_EMAIL = "billing-user@example.com";

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

describe("cancel subscription (wazoo-console#53)", () => {
  let dir: string;
  let env: Bindings;
  let sessionToken: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "wazoo-api-billing-cancel-"));
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
          displayName: "Billing User",
          ageConfirmed: true,
        }),
      },
      env,
    );
    expect(sessionRes.status).toBe(201);
    sessionToken = ((await sessionRes.json()) as { token: string }).token;

    // Look up the user and seed a world with a configured subscription.
    const me = await api(
      "/v1/users/me",
      { headers: authHeaders(sessionToken) },
      env,
    );
    const userUid = ((await me.json()) as { user: { uid: string } }).user.uid;
    const seed = createClient({ url: `file:${dbPath}` });
    const ts = new Date().toISOString();
    await seed.execute({
      sql: "INSERT INTO worlds (uid, user_uid, world_id, display_name, state, stripe_customer_id, stripe_subscription_id, billing_state, create_time, update_time) VALUES (?, ?, ?, ?, 'active', 'cus_test', 'sub_test', 'ACTIVE', ?, ?)",
      args: ["w_billing_1", userUid, "billing-world", "Billing World", ts, ts],
    });
    await seed.execute({
      sql: "INSERT INTO worlds (uid, user_uid, world_id, display_name, state, billing_state, create_time, update_time) VALUES (?, ?, ?, ?, 'active', 'BETA_FREE', ?, ?)",
      args: ["w_billing_free", userUid, "free-world", "Free World", ts, ts],
    });
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

  it("rejects cancel for a world on the free beta tier", async () => {
    const res = await api(
      "/v1/worlds/free-world/billing/cancel",
      { method: "POST", headers: authHeaders(sessionToken) },
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FAILED_PRECONDITION");
  });

  it("cancels a configured subscription without a provider call", async () => {
    // No STRIPE_SECRET_KEY in bindings, so the route skips the provider call
    // and marks the world CANCELLED with the subscription id cleared.
    const res = await api(
      "/v1/worlds/billing-world/billing/cancel",
      { method: "POST", headers: authHeaders(sessionToken) },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      billing: { state: string; subscriptionConfigured: boolean };
    };
    expect(body.billing.state).toBe("CANCELLED");
    expect(body.billing.subscriptionConfigured).toBe(false);
  });

  it("cancels via Stripe when a secret key is configured", async () => {
    // Reset the world to a configured subscription.
    const client = createClient({ url: `file:${env.TURSO_DATABASE_URL}` });
    await client.execute({
      sql: "UPDATE worlds SET stripe_subscription_id = 'sub_test2', billing_state = 'ACTIVE' WHERE world_id = 'billing-world'",
    });
    await client.close();

    const stripeFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "sub_test2", status: "canceled" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", stripeFetch);

    const stripeEnv = { ...env, STRIPE_SECRET_KEY: "sk_test" };
    const res = await Promise.resolve(
      app.request(
        "/v1/worlds/billing-world/billing/cancel",
        {
          method: "POST",
          headers: authHeaders(sessionToken),
        },
        stripeEnv,
        executionCtx,
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { billing: { state: string } };
    expect(body.billing.state).toBe("CANCELLED");
    expect(stripeFetch).toHaveBeenCalledWith(
      "https://api.stripe.com/v1/subscriptions/sub_test2",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
