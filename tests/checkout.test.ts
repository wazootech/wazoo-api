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
import { encodeStripeParams, verifyStripeSignature } from "../src/lib/stripe";

import { createTestD1, type TestD1 } from "./helpers/d1-test-adapter";

const ADMIN_TOKEN = "wzp_test-admin-token";
const WORLDS_BASE = "http://localhost:9999";
const WEBHOOK_SECRET = "whsec_test_signing_secret";

const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const authHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

async function sign(payload: string, secret = WEBHOOK_SECRET, t?: number) {
  const timestamp = t ?? Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
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

/** Calls the fake worlds-api and Stripe received, for assertions. */
let worldsCalls: { method: string; path: string; body?: unknown }[] = [];
let stripeCalls: { path: string; params: URLSearchParams }[] = [];
let worldsBudgetStatus = 200;
let stripeStatus = 200;
const stripeUrl = "https://checkout.stripe.com/c/pay/cs_test_123";

async function fakeFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const req =
    input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url);
  if (url.hostname === "api.stripe.com") {
    const params = new URLSearchParams(await req.text());
    stripeCalls.push({ path: url.pathname, params });
    if (stripeStatus !== 200) {
      return json(
        { error: { message: "No such price: 'price_bad'" } },
        stripeStatus,
      );
    }
    return json({ id: "cs_test_123", url: stripeUrl });
  }
  const path = req.url.slice(WORLDS_BASE.length);
  const text =
    req.method === "GET" || req.method === "DELETE" ? "" : await req.text();
  worldsCalls.push({
    method: req.method,
    path,
    body: text ? JSON.parse(text) : undefined,
  });
  if (/^\/admin\/namespaces\/[^/]+\/write-budget$/.test(path)) {
    if (req.method === "PUT") {
      if (worldsBudgetStatus !== 200) {
        return json(
          { error: { code: "INTERNAL", message: "down" } },
          worldsBudgetStatus,
        );
      }
      const dailyRows = JSON.parse(text).dailyRows;
      return json({
        namespace: "ns",
        dailyRows,
        defaultDailyRows: null,
        effectiveDailyRows: dailyRows,
        rowsWrittenToday: 0,
        day: "2026-10-28",
      });
    }
    return json({
      namespace: "ns",
      dailyRows: 50000,
      defaultDailyRows: null,
      effectiveDailyRows: 50000,
      rowsWrittenToday: 0,
      day: "2026-10-28",
    });
  }
  return json({ error: { code: "UNEXPECTED", message: path } }, 500);
}

describe("stripe helpers", () => {
  it("form-encodes nested params the way Stripe expects", () => {
    expect(
      encodeStripeParams({
        mode: "subscription",
        line_items: [{ price: "price_1", quantity: 1 }],
        metadata: { user_uid: "u 1" },
        skip: undefined,
        none: null,
      }).sort(),
    ).toEqual(
      [
        "line_items%5B0%5D%5Bprice%5D=price_1",
        "line_items%5B0%5D%5Bquantity%5D=1",
        "metadata%5Buser_uid%5D=u%201",
        "mode=subscription",
      ].sort(),
    );
  });

  describe("verifyStripeSignature", () => {
    const body = '{"id":"evt_1"}';
    const now = 1_800_000_000;

    it("accepts a fresh, correct signature, and any matching v1", async () => {
      const header = await sign(body, WEBHOOK_SECRET, now);
      expect(
        await verifyStripeSignature(body, header, WEBHOOK_SECRET, now),
      ).toBe(true);
      const withOld = `${header},v1=${"0".repeat(64)}`;
      expect(
        await verifyStripeSignature(body, withOld, WEBHOOK_SECRET, now),
      ).toBe(true);
    });

    it("rejects a replayed (old) or future-dated signature", async () => {
      const old = await sign(body, WEBHOOK_SECRET, now - 301);
      const future = await sign(body, WEBHOOK_SECRET, now + 301);
      expect(await verifyStripeSignature(body, old, WEBHOOK_SECRET, now)).toBe(
        false,
      );
      expect(
        await verifyStripeSignature(body, future, WEBHOOK_SECRET, now),
      ).toBe(false);
      const edge = await sign(body, WEBHOOK_SECRET, now - 300);
      expect(await verifyStripeSignature(body, edge, WEBHOOK_SECRET, now)).toBe(
        true,
      );
    });

    it("rejects a wrong secret, a changed body, and malformed headers", async () => {
      const header = await sign(body, WEBHOOK_SECRET, now);
      expect(
        await verifyStripeSignature(body, header, "whsec_other", now),
      ).toBe(false);
      expect(
        await verifyStripeSignature(body + " ", header, WEBHOOK_SECRET, now),
      ).toBe(false);
      for (const bad of [
        "",
        "t=1",
        "v1=abcd",
        `t=x,v1=${"a".repeat(64)}`,
        `t=${now},v1=zz`,
        `t=${now},v1=abc`,
      ]) {
        expect(
          await verifyStripeSignature(body, bad, WEBHOOK_SECRET, now),
          bad,
        ).toBe(false);
      }
    });
  });
});

describe("checkout, portal and subscription webhooks", () => {
  let dir: string;
  let dbPath: string;
  let userToken: string;
  let userUid: string;

  const baseEnv = (): Bindings & { DB: TestD1 } => ({
    DB: createTestD1(dbPath),
    WORLDS_API_URL: WORLDS_BASE,
    WORLDS_API_ADMIN_KEY: "test",
    WAZOO_PLATFORM_ADMIN_TOKEN: ADMIN_TOKEN,
    WAZOO_ENV: "test",
    STRIPE_SECRET_KEY: "sk_test_x",
    STRIPE_PRICE_ID: "price_pro",
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    CONSOLE_URL: "https://console-qa.wazoo.dev/",
  });
  let env: Bindings & { DB: TestD1 };

  const api = (path: string, init: RequestInit = {}, e: Bindings = env) =>
    Promise.resolve(app.request(path, init, e, executionCtx));
  const asUser = (path: string, method = "POST", e: Bindings = env) =>
    api(path, { method, headers: authHeaders(userToken) }, e);

  const rows = <T>(sql: string, ...args: unknown[]) => {
    const client = new DatabaseSync(dbPath);
    try {
      return client.prepare(sql).all(...(args as never[])) as T[];
    } finally {
      client.close();
    }
  };
  const run = (sql: string, ...args: unknown[]) => {
    const client = new DatabaseSync(dbPath);
    try {
      client.prepare(sql).run(...(args as never[]));
    } finally {
      client.close();
    }
  };
  const userRow = () =>
    rows<{
      plan: string;
      stripe_customer_id: string | null;
      stripe_subscription_id: string | null;
    }>(
      "SELECT plan, stripe_customer_id, stripe_subscription_id FROM users WHERE uid = ?",
      userUid,
    )[0]!;

  let eventCounter = 0;
  const webhook = async (
    type: string,
    object: Record<string, unknown>,
    id = `evt_${++eventCounter}`,
  ) => {
    const payload = JSON.stringify({ id, type, data: { object } });
    return api("/v1/stripe/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": await sign(payload),
      },
      body: payload,
    });
  };
  const budgetPuts = () => worldsCalls.filter((c) => c.method === "PUT");

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "wazoo-api-checkout-"));
    dbPath = join(dir, "test.db");
    const client = new DatabaseSync(dbPath);
    client.exec(readFileSync(join(process.cwd(), "schema.sql"), "utf8"));
    client.close();
    env = baseEnv();
    vi.stubGlobal("fetch", vi.fn(fakeFetch));

    const session = await api("/v1/auth/workos-session", {
      method: "POST",
      headers: authHeaders(ADMIN_TOKEN),
      body: JSON.stringify({
        email: "payer@example.com",
        displayName: "Payer",
        ageConfirmed: true,
      }),
    });
    expect(session.status).toBe(201);
    userToken = ((await session.json()) as { token: string }).token;
    const me = await api("/v1/users/me", { headers: authHeaders(userToken) });
    userUid = ((await me.json()) as { user: { uid: string } }).user.uid;
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

  beforeEach(() => {
    worldsCalls = [];
    stripeCalls = [];
    worldsBudgetStatus = 200;
    stripeStatus = 200;
    run(
      "UPDATE users SET plan = 'free', stripe_customer_id = NULL, stripe_subscription_id = NULL WHERE uid = ?",
      userUid,
    );
    run("DELETE FROM stripe_events");
  });

  describe("POST /v1/users/me/billing/checkout", () => {
    it("starts a subscription checkout for the user and returns the hosted URL", async () => {
      const res = await asUser("/v1/users/me/billing/checkout");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ url: stripeUrl });

      expect(stripeCalls).toHaveLength(1);
      const { path, params } = stripeCalls[0]!;
      expect(path).toBe("/v1/checkout/sessions");
      expect(params.get("mode")).toBe("subscription");
      expect(params.get("line_items[0][price]")).toBe("price_pro");
      expect(params.get("line_items[0][quantity]")).toBe("1");
      expect(params.get("client_reference_id")).toBe(userUid);
      expect(params.get("customer_email")).toBe("payer@example.com");
      expect(params.get("customer")).toBeNull();
      expect(params.get("metadata[user_uid]")).toBe(userUid);
      expect(params.get("subscription_data[metadata][user_uid]")).toBe(userUid);
      // Return URLs come from configuration, never from the request.
      expect(params.get("success_url")).toBe(
        "https://console-qa.wazoo.dev/settings?checkout=success",
      );
      expect(params.get("cancel_url")).toBe(
        "https://console-qa.wazoo.dev/settings?checkout=cancelled",
      );
    });

    it("reuses the Stripe customer for a returning user", async () => {
      run(
        "UPDATE users SET stripe_customer_id = 'cus_1' WHERE uid = ?",
        userUid,
      );
      await asUser("/v1/users/me/billing/checkout");
      const { params } = stripeCalls[0]!;
      expect(params.get("customer")).toBe("cus_1");
      expect(params.get("customer_email")).toBeNull();
    });

    it("is unavailable until Stripe and the console URL are configured", async () => {
      for (const missing of [
        "STRIPE_SECRET_KEY",
        "STRIPE_PRICE_ID",
        "CONSOLE_URL",
      ] as const) {
        const res = await asUser("/v1/users/me/billing/checkout", "POST", {
          ...env,
          [missing]: "",
        });
        expect(res.status, missing).toBe(503);
        expect(
          ((await res.json()) as { error: { code: string } }).error.code,
        ).toBe("BILLING_NOT_CONFIGURED");
      }
      expect(stripeCalls).toHaveLength(0);
    });

    it("refuses a user who is already subscribed to Pro", async () => {
      run(
        "UPDATE users SET plan = 'pro', stripe_subscription_id = 'sub_1' WHERE uid = ?",
        userUid,
      );
      const res = await asUser("/v1/users/me/billing/checkout");
      expect(res.status).toBe(409);
      expect(
        ((await res.json()) as { error: { code: string } }).error.code,
      ).toBe("ALREADY_SUBSCRIBED");
      expect(stripeCalls).toHaveLength(0);
    });

    it("hides Stripe's error text behind a generic 502", async () => {
      stripeStatus = 400;
      const res = await asUser("/v1/users/me/billing/checkout");
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("STRIPE_ERROR");
      expect(JSON.stringify(body)).not.toContain("price_bad");
    });

    it("requires a signed-in user", async () => {
      const res = await api("/v1/users/me/billing/checkout", {
        method: "POST",
      });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /v1/users/me/billing/portal", () => {
    it("opens the portal for a user with a Stripe customer", async () => {
      run(
        "UPDATE users SET stripe_customer_id = 'cus_9' WHERE uid = ?",
        userUid,
      );
      const res = await asUser("/v1/users/me/billing/portal");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ url: stripeUrl });
      const { path, params } = stripeCalls[0]!;
      expect(path).toBe("/v1/billing_portal/sessions");
      expect(params.get("customer")).toBe("cus_9");
      expect(params.get("return_url")).toBe(
        "https://console-qa.wazoo.dev/settings",
      );
    });

    it("has nothing to open before the first checkout", async () => {
      const res = await asUser("/v1/users/me/billing/portal");
      expect(res.status).toBe(409);
      expect(
        ((await res.json()) as { error: { code: string } }).error.code,
      ).toBe("NO_BILLING_ACCOUNT");
    });
  });

  describe("GET /v1/users/me/plan billing flags", () => {
    it("offers checkout to a free user, and the portal once they have a customer", async () => {
      let plan = (await (await asUser("/v1/users/me/plan", "GET")).json()) as {
        billing: unknown;
      };
      expect(plan.billing).toEqual({
        checkoutAvailable: true,
        portalAvailable: false,
      });
      run(
        "UPDATE users SET plan = 'pro', stripe_customer_id = 'cus_1' WHERE uid = ?",
        userUid,
      );
      plan = (await (await asUser("/v1/users/me/plan", "GET")).json()) as {
        billing: unknown;
      };
      expect(plan.billing).toEqual({
        checkoutAvailable: false,
        portalAvailable: true,
      });
    });

    it("offers nothing when billing is not configured", async () => {
      const plan = (await (
        await asUser("/v1/users/me/plan", "GET", {
          ...env,
          STRIPE_PRICE_ID: "",
        })
      ).json()) as { billing: unknown };
      expect(plan.billing).toEqual({
        checkoutAvailable: false,
        portalAvailable: false,
      });
    });
  });

  describe("webhook", () => {
    it("moves the user to Pro and applies the Pro budget when checkout completes", async () => {
      const res = await webhook("checkout.session.completed", {
        mode: "subscription",
        client_reference_id: userUid,
        customer: "cus_new",
        subscription: "sub_new",
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: true, handled: true });
      expect(userRow()).toEqual({
        plan: "pro",
        stripe_customer_id: "cus_new",
        stripe_subscription_id: "sub_new",
      });
      expect(budgetPuts().at(-1)).toMatchObject({
        path: `/admin/namespaces/${userUid}/write-budget`,
        body: { dailyRows: 1_000_000 },
      });
    });

    it("ignores a redelivered event", async () => {
      const object = {
        mode: "subscription",
        client_reference_id: userUid,
        customer: "cus_d",
        subscription: "sub_d",
      };
      await webhook("checkout.session.completed", object, "evt_dup");
      worldsCalls = [];
      run("UPDATE users SET plan = 'free' WHERE uid = ?", userUid);
      const again = await webhook(
        "checkout.session.completed",
        object,
        "evt_dup",
      );
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual({ received: true, duplicate: true });
      expect(worldsCalls).toHaveLength(0);
      expect(userRow().plan).toBe("free");
    });

    it("keeps Pro while a payment is past due, and drops to free once cancelled", async () => {
      run(
        "UPDATE users SET plan = 'pro', stripe_customer_id = 'cus_p', stripe_subscription_id = 'sub_p' WHERE uid = ?",
        userUid,
      );
      await webhook("customer.subscription.updated", {
        id: "sub_p",
        customer: "cus_p",
        status: "past_due",
      });
      expect(userRow().plan).toBe("pro");

      await webhook("customer.subscription.updated", {
        id: "sub_p",
        customer: "cus_p",
        status: "canceled",
      });
      expect(userRow()).toEqual({
        plan: "free",
        stripe_customer_id: "cus_p",
        stripe_subscription_id: null,
      });
      expect(budgetPuts().at(-1)?.body).toEqual({ dailyRows: 50_000 });
    });

    it("returns the user to free when the subscription is deleted", async () => {
      run(
        "UPDATE users SET plan = 'pro', stripe_customer_id = 'cus_q', stripe_subscription_id = 'sub_q' WHERE uid = ?",
        userUid,
      );
      const res = await webhook("customer.subscription.deleted", {
        id: "sub_q",
        customer: "cus_q",
        status: "canceled",
      });
      expect(await res.json()).toEqual({ received: true, handled: true });
      expect(userRow().plan).toBe("free");
    });

    it("does not downgrade for a late event about an old subscription", async () => {
      run(
        "UPDATE users SET plan = 'pro', stripe_customer_id = 'cus_r', stripe_subscription_id = 'sub_new' WHERE uid = ?",
        userUid,
      );
      const res = await webhook("customer.subscription.deleted", {
        id: "sub_old",
        customer: "cus_r",
        status: "canceled",
      });
      expect(await res.json()).toEqual({ received: true, handled: false });
      expect(userRow()).toMatchObject({
        plan: "pro",
        stripe_subscription_id: "sub_new",
      });
    });

    it("finds the user from subscription metadata when the customer is not stored yet", async () => {
      await webhook("customer.subscription.created", {
        id: "sub_m",
        customer: "cus_m",
        status: "active",
        metadata: { user_uid: userUid },
      });
      expect(userRow()).toEqual({
        plan: "pro",
        stripe_customer_id: "cus_m",
        stripe_subscription_id: "sub_m",
      });
    });

    it("acknowledges events for unknown users and other event types without changing anything", async () => {
      const unknown = await webhook("customer.subscription.updated", {
        id: "sub_x",
        customer: "cus_nobody",
        status: "active",
      });
      expect(unknown.status).toBe(200);
      expect(await unknown.json()).toEqual({ received: true, handled: false });
      const other = await webhook("invoice.paid", { id: "in_1" });
      expect(await other.json()).toEqual({ received: true, handled: false });
      const payment = await webhook("checkout.session.completed", {
        mode: "payment",
        client_reference_id: userUid,
      });
      expect(await payment.json()).toEqual({ received: true, handled: false });
      expect(userRow().plan).toBe("free");
    });

    it("answers 500 so Stripe retries when the data plane refuses the budget, then succeeds on retry", async () => {
      worldsBudgetStatus = 500;
      const object = {
        mode: "subscription",
        client_reference_id: userUid,
        customer: "cus_f",
        subscription: "sub_f",
      };
      const failed = await webhook(
        "checkout.session.completed",
        object,
        "evt_retry",
      );
      expect(failed.status).toBe(500);
      expect(
        rows("SELECT 1 FROM stripe_events WHERE event_id = 'evt_retry'"),
      ).toHaveLength(0);

      worldsBudgetStatus = 200;
      const retried = await webhook(
        "checkout.session.completed",
        object,
        "evt_retry",
      );
      expect(retried.status).toBe(200);
      expect(await retried.json()).toEqual({ received: true, handled: true });
      expect(
        rows("SELECT 1 FROM stripe_events WHERE event_id = 'evt_retry'"),
      ).toHaveLength(1);
    });

    it("rejects a bad signature, a stale timestamp, and a body that is not an event", async () => {
      const payload = JSON.stringify({
        id: "evt_s",
        type: "checkout.session.completed",
        data: { object: {} },
      });
      const forged = await api("/v1/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": await sign(payload, "whsec_other") },
        body: payload,
      });
      expect(forged.status).toBe(401);
      const stale = await api("/v1/stripe/webhook", {
        method: "POST",
        headers: {
          "stripe-signature": await sign(
            payload,
            WEBHOOK_SECRET,
            Math.floor(Date.now() / 1000) - 3600,
          ),
        },
        body: payload,
      });
      expect(stale.status).toBe(401);

      for (const body of ["not json", JSON.stringify({ hello: "world" })]) {
        const res = await api("/v1/stripe/webhook", {
          method: "POST",
          headers: { "stripe-signature": await sign(body) },
          body,
        });
        expect(res.status, body).toBe(400);
      }
    });
  });
});
