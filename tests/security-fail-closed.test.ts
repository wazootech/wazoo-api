import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import app from "../src/index";
import type { Bindings } from "../src/env";
import {
  clearAllowlistCache,
  getApprovedEmails,
} from "../src/lib/beta-allowlist";

// These cover the two fail-closed paths from wazoo-api#76 and the beta
// allowlist: an unset Stripe signing secret must not degrade into an
// unauthenticated endpoint, and an unreadable allowlist must not degrade into
// a single hardcoded identity.

const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const WEBHOOK_SECRET = "whsec_test_signing_secret";

function bindings(overrides: Partial<Bindings> = {}): Bindings {
  return {
    WORLDS_API_URL: "http://localhost:9999",
    WORLDS_API_ADMIN_KEY: "test",
    WAZOO_ENV: "test",
    ...overrides,
  } as Bindings;
}

function post(path: string, body: string, env: Bindings, signature?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (signature !== undefined) headers["stripe-signature"] = signature;
  return Promise.resolve(
    app.request(path, { method: "POST", headers, body }, env, executionCtx),
  );
}

async function signStripeHeader(
  payload: string,
  secret: string,
): Promise<string> {
  // verifyStripeSignature computes HMAC-SHA256 over `${timestamp}.${body}`.
  const timestamp = Math.floor(Date.now() / 1000);
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

describe("stripe webhook fails closed (#76)", () => {
  it("rejects with 503 when STRIPE_WEBHOOK_SECRET is not configured", async () => {
    const res = await post("/v1/stripe/webhook", "{}", bindings());

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "SERVICE_UNAVAILABLE" },
    });
  });

  it("rejects an unsigned body with 503 when unconfigured, not 200", async () => {
    // This is the exact shape that returned 200 {"received":true} in
    // production before the fix.
    const res = await post(
      "/v1/stripe/webhook",
      JSON.stringify({
        id: "evt_probe",
        type: "customer.subscription.deleted",
        data: { object: { id: "sub_probe" } },
      }),
      bindings(),
    );

    expect(res.status).toBe(503);
  });

  it("still rejects a forged signature with 401 once configured", async () => {
    const res = await post(
      "/v1/stripe/webhook",
      "{}",
      bindings({ STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET }),
      "t=1,v1=deadbeef",
    );

    expect(res.status).toBe(401);
  });

  it("rejects a missing signature header with 401 once configured", async () => {
    const res = await post(
      "/v1/stripe/webhook",
      "{}",
      bindings({ STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET }),
    );

    expect(res.status).toBe(401);
  });

  it("accepts a correctly signed body when configured", async () => {
    const payload = JSON.stringify({ id: "evt_ok", type: "ping" });
    const signature = await signStripeHeader(payload, WEBHOOK_SECRET);

    const res = await post(
      "/v1/stripe/webhook",
      payload,
      bindings({ STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET }),
      signature,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true });
  });

  it("treats an empty-string secret as unconfigured, not as a valid one", async () => {
    // wrangler.toml ships STRIPE_PRICE_ID = ""; a blank secret must not be
    // read as "configured but matching nothing".
    const res = await post(
      "/v1/stripe/webhook",
      "{}",
      bindings({
        STRIPE_WEBHOOK_SECRET: "",
      }),
    );

    expect(res.status).toBe(503);
  });
});

describe("beta allowlist fails closed", () => {
  // getAccessToken parses the key as JSON and signs a JWT with its
  // private_key, so the fixture has to be a genuine service-account shape.
  let serviceAccountKey: string;

  beforeAll(() => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    serviceAccountKey = JSON.stringify({
      client_email: "beta-allowlist@test.iam.gserviceaccount.com",
      private_key: privateKey,
      project_id: "wazoo-test",
      type: "service_account",
    });
  });

  // Route the token exchange and the Sheets call separately so each can be
  // failed in isolation.
  function stubGoogle(opts: { sheetsStatus: number }) {
    const impl = (url: string): Promise<Response> => {
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ access_token: "t", expires_in: 3600 }),
            {
              status: 200,
            },
          ),
        );
      }
      if (url.startsWith("https://sheets.googleapis.com/")) {
        return Promise.resolve(
          new Response(
            opts.sheetsStatus === 200
              ? JSON.stringify({
                  values: [
                    ["approved@example.com", "", "", "TRUE"],
                    ["pending@example.com", "", "", "FALSE"],
                  ],
                })
              : "upstream failure",
            { status: opts.sheetsStatus },
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    };
    vi.stubGlobal("fetch", vi.fn(impl));
  }

  afterEach(() => {
    clearAllowlistCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const SHEET_STATUS_OK = 200;

  it("returns the sheet contents when Sheets responds", async () => {
    stubGoogle({ sheetsStatus: SHEET_STATUS_OK });

    const approved = await getApprovedEmails(serviceAccountKey);

    expect(approved.has("approved@example.com")).toBe(true);
    expect(approved.has("pending@example.com")).toBe(false);
  });

  it("throws rather than granting a fallback identity when Sheets fails", async () => {
    stubGoogle({ sheetsStatus: 500 });

    // Before the fix this resolved to a Set containing exactly one hardcoded
    // address, silently locking every other beta user out.
    await expect(getApprovedEmails(serviceAccountKey)).rejects.toThrow(
      /Google Sheets API error/,
    );
  });

  it("throws when no service account key is configured", async () => {
    await expect(getApprovedEmails("")).rejects.toThrow(
      /GOOGLE_SERVICE_ACCOUNT_KEY is not configured/,
    );
  });

  it("never returns the previously hardcoded identity as a fallback", async () => {
    stubGoogle({ sheetsStatus: 500 });

    const result = await getApprovedEmails(serviceAccountKey).catch(() => null);

    // The key assertion: whatever happens, that address is not conjured.
    expect(result === null || !result.has("ethan.r.davidson@gmail.com")).toBe(
      true,
    );
  });

  it("serves a stale allowlist rather than locking everyone out", async () => {
    stubGoogle({ sheetsStatus: SHEET_STATUS_OK });
    await getApprovedEmails(serviceAccountKey);

    stubGoogle({ sheetsStatus: 503 });
    const approved = await getApprovedEmails(serviceAccountKey);

    expect(approved.has("approved@example.com")).toBe(true);
  });

  it("fails closed on a bad token exchange too, not just a bad Sheets read", async () => {
    // sheets-auth caches the OAuth token in a module-global, so a token cached
    // by an earlier test would skip the exchange entirely and make this test
    // order-dependent. Reset the module registry for this case only.
    vi.resetModules();
    const { getApprovedEmails: freshGetApprovedEmails } =
      await import("../src/lib/beta-allowlist");

    const impl = (url: string): Promise<Response> => {
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return Promise.resolve(new Response("invalid_grant", { status: 400 }));
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    };
    vi.stubGlobal("fetch", vi.fn(impl));

    await expect(freshGetApprovedEmails(serviceAccountKey)).rejects.toThrow(
      /token request failed/,
    );
  });
});
