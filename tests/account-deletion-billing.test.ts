import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app from "../src/index";
import type { Bindings } from "../src/env";
import { sha256Hex } from "../src/lib/crypto";

import { createTestD1, type TestD1 } from "./helpers/d1-test-adapter";

const ADMIN_TOKEN = "wzp_test-admin-token";
const STRIPE_KEY = "sk_test_fake_key";
const WEBHOOK_SECRET = "whsec_test_signing_secret";

type TestBindings = Bindings & { DB: TestD1 };

const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const api = (path: string, init: RequestInit, env: Bindings) =>
  Promise.resolve(app.request(path, init, env, executionCtx));

const authHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

async function sign(payload: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  const hex = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `t=${timestamp},v1=${hex}`;
}

describe("account deletion cancels the Stripe subscription", () => {
  let dir: string;
  let dbPath: string;
  let env: TestBindings;
  /** Calls to fake Stripe and worlds-api, in order. */
  let calls: {
    host: string;
    method: string;
    path: string;
    auth: string | null;
  }[];
  let stripeStatus: number;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "wazoo-api-deletion-billing-"));
    dbPath = join(dir, "test.db");
    const client = new DatabaseSync(dbPath);
    client.exec(readFileSync(join(process.cwd(), "schema.sql"), "utf8"));
    client.close();
    env = {
      DB: createTestD1(dbPath),
      WORLDS_API_URL: "http://localhost:9999",
      WORLDS_API_ADMIN_KEY: "test",
      WAZOO_PLATFORM_ADMIN_TOKEN: ADMIN_TOKEN,
      WAZOO_ENV: "test",
      STRIPE_SECRET_KEY: STRIPE_KEY,
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    };
  });

  beforeEach(() => {
    calls = [];
    stripeStatus = 200;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const req =
          input instanceof Request ? input : new Request(String(input), init);
        const url = new URL(req.url);
        calls.push({
          host: url.hostname,
          method: req.method,
          path: url.pathname,
          auth: req.headers.get("authorization"),
        });
        if (url.hostname === "api.stripe.com") {
          return stripeStatus === 200
            ? json({ id: "sub_x", status: "canceled" })
            : json({ error: { message: "boom" } }, stripeStatus);
        }
        return json({ deletedWorlds: 0, revokedKeys: 0 });
      }),
    );
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

  /** Creates a user (optionally with a subscription) and a valid confirmation token. */
  async function seedUser(email: string, subscriptionId: string | null) {
    const session = await api(
      "/v1/auth/workos-session",
      {
        method: "POST",
        headers: authHeaders(ADMIN_TOKEN),
        body: JSON.stringify({
          email,
          displayName: "Billing Delete",
          ageConfirmed: true,
        }),
      },
      env,
    );
    expect(session.status).toBe(201);
    const token = ((await session.json()) as { token: string }).token;
    const me = await api("/v1/users/me", { headers: authHeaders(token) }, env);
    const uid = ((await me.json()) as { user: { uid: string } }).user.uid;

    const rawToken = `wzdel_${uid}`;
    const client = new DatabaseSync(dbPath);
    if (subscriptionId) {
      client
        .prepare(
          "UPDATE users SET plan = 'pro', stripe_customer_id = ?, stripe_subscription_id = ? WHERE uid = ?",
        )
        .run(`cus_${uid}`, subscriptionId, uid);
    }
    client
      .prepare(
        "INSERT INTO deletion_requests (uid, user_uid, token_hash, expires_at) VALUES (?, ?, ?, ?)",
      )
      .run(
        `req_${uid}`,
        uid,
        await sha256Hex(rawToken),
        new Date(Date.now() + 60_000).toISOString(),
      );
    client.close();
    return { token, uid, rawToken };
  }

  const confirm = (u: { token: string; rawToken: string }) =>
    api(
      "/v1/users/me",
      {
        method: "DELETE",
        headers: authHeaders(u.token),
        body: JSON.stringify({ confirmationToken: u.rawToken }),
      },
      env,
    );

  const userExists = (uid: string) => {
    const client = new DatabaseSync(dbPath);
    const row = client.prepare("SELECT uid FROM users WHERE uid = ?").get(uid);
    client.close();
    return Boolean(row);
  };

  it("cancels the subscription before the worlds are touched, then deletes the user", async () => {
    const u = await seedUser("pro-delete@example.com", "sub_live_1");
    const res = await confirm(u);
    expect(res.status).toBe(204);

    const stripeCalls = calls.filter((c) => c.host === "api.stripe.com");
    expect(stripeCalls).toEqual([
      {
        host: "api.stripe.com",
        method: "DELETE",
        path: "/v1/subscriptions/sub_live_1",
        auth: `Bearer ${STRIPE_KEY}`,
      },
    ]);
    const stripeAt = calls.findIndex((c) => c.host === "api.stripe.com");
    const worldsAt = calls.findIndex((c) => c.host === "localhost");
    expect(stripeAt).toBeGreaterThanOrEqual(0);
    expect(worldsAt).toBeGreaterThan(stripeAt);
    expect(userExists(u.uid)).toBe(false);
  });

  it("refuses to delete when Stripe cannot cancel, leaving the account and worlds intact", async () => {
    const u = await seedUser("pro-stuck@example.com", "sub_live_2");
    stripeStatus = 500;
    const res = await confirm(u);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "BILLING_CANCEL_FAILED",
    );
    expect(userExists(u.uid)).toBe(true);
    expect(calls.some((c) => c.host === "localhost")).toBe(false);

    // The user can retry once Stripe recovers.
    stripeStatus = 200;
    expect((await confirm(u)).status).toBe(204);
    expect(userExists(u.uid)).toBe(false);
  });

  it("treats a subscription Stripe no longer knows (404) as already canceled", async () => {
    const u = await seedUser("pro-gone@example.com", "sub_live_3");
    stripeStatus = 404;
    expect((await confirm(u)).status).toBe(204);
    expect(userExists(u.uid)).toBe(false);
  });

  it("does not call Stripe for a user with no subscription", async () => {
    const u = await seedUser("free-delete@example.com", null);
    expect((await confirm(u)).status).toBe(204);
    expect(calls.some((c) => c.host === "api.stripe.com")).toBe(false);
  });

  it("acknowledges the cancel webhook for a user that no longer exists", async () => {
    const payload = JSON.stringify({
      id: "evt_after_delete",
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_live_1",
          customer: "cus_gone",
          status: "canceled",
          metadata: {},
        },
      },
    });
    const res = await api(
      "/v1/stripe/webhook",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await sign(payload),
        },
        body: payload,
      },
      env,
    );
    expect(res.status).toBe(200);
  });
});
