import { afterAll, beforeAll, beforeEach, expect, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app from "../../src/index";
import type { Bindings } from "../../src/env";
import { createTestD1, type TestD1 } from "./d1-test-adapter";

export const ADMIN_TOKEN = "wzp_test-admin-token";
const WORLDS_BASE = "http://localhost:9999";
export const WEBHOOK_SECRET = "whsec_test_signing_secret";

const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const authHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

export async function sign(
  payload: string,
  secret = WEBHOOK_SECRET,
  t?: number,
) {
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

/** Calls the fake worlds-api and Stripe received, for assertions. */
export const state = {
  worldsCalls: [] as { method: string; path: string; body?: unknown }[],
  stripeCalls: [] as { path: string; params: URLSearchParams }[],
  worldsBudgetStatus: 200,
  stripeStatus: 200,
};
export const stripeUrl = "https://checkout.stripe.com/c/pay/cs_test_123";

async function fakeFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const req =
    input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url);
  if (url.hostname === "api.stripe.com") {
    const params = new URLSearchParams(await req.text());
    state.stripeCalls.push({ path: url.pathname, params });
    if (state.stripeStatus !== 200) {
      return json(
        { error: { message: "No such price: 'price_bad'" } },
        state.stripeStatus,
      );
    }
    return json({ id: "cs_test_123", url: stripeUrl });
  }
  const path = req.url.slice(WORLDS_BASE.length);
  const text =
    req.method === "GET" || req.method === "DELETE" ? "" : await req.text();
  state.worldsCalls.push({
    method: req.method,
    path,
    body: text ? JSON.parse(text) : undefined,
  });
  if (/^\/admin\/namespaces\/[^/]+\/write-budget$/.test(path)) {
    if (req.method === "PUT") {
      if (state.worldsBudgetStatus !== 200) {
        return json(
          { error: { code: "INTERNAL", message: "down" } },
          state.worldsBudgetStatus,
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

/** Registers the shared suite setup (database, user, fake fetch) in the calling describe. */
export function useCheckoutHarness() {
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
  const budgetPuts = () => state.worldsCalls.filter((c) => c.method === "PUT");

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
    state.worldsCalls = [];
    state.stripeCalls = [];
    state.worldsBudgetStatus = 200;
    state.stripeStatus = 200;
    run(
      "UPDATE users SET plan = 'free', stripe_customer_id = NULL, stripe_subscription_id = NULL WHERE uid = ?",
      userUid,
    );
    run("DELETE FROM stripe_events");
  });

  return {
    api,
    asUser,
    rows,
    run,
    userRow,
    webhook,
    budgetPuts,
    get env() {
      return env;
    },
    get userUid() {
      return userUid;
    },
  };
}
