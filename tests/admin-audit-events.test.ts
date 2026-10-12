import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import app from "../src/index";
import type { Bindings } from "../src/env";

import { createTestD1 } from "./helpers/d1-test-adapter";

// Must start with wzp_ so requireAuth accepts it before comparing to the
// env admin token.
const ADMIN_TOKEN = "wzp_test-admin-token";
const TEST_EMAIL = "audit-user@example.com";

const { privateKey: SA_PRIVATE_KEY } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const SERVICE_ACCOUNT_KEY = JSON.stringify({
  client_email: "admin-audit@test.iam.gserviceaccount.com",
  private_key: SA_PRIVATE_KEY,
  project_id: "wazoo-test",
  type: "service_account",
});

function stubAllowlistFetch(): void {
  const impl = (url: string): Promise<Response> => {
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), {
          status: 200,
        }),
      );
    }
    if (url.startsWith("https://sheets.googleapis.com/")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ values: [[TEST_EMAIL, "", "", "TRUE"]] }),
          {
            status: 200,
          },
        ),
      );
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  };
  vi.stubGlobal("fetch", vi.fn(impl));
}

const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

function api(path: string, token: string | null, env: Bindings) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return Promise.resolve(app.request(path, { headers }, env, executionCtx));
}

type AuditList = {
  auditEvents: Array<{ uid: string; action: string; createTime: string }>;
  total: number;
};

describe("GET /v1/admin/audit-events (wazoo-api#81)", () => {
  let dir: string;
  let env: Bindings;
  let sessionToken: string;

  beforeAll(async () => {
    stubAllowlistFetch();
    dir = mkdtempSync(join(tmpdir(), "wazoo-api-admin-audit-"));
    const dbPath = join(dir, "test.db");
    const client = new DatabaseSync(dbPath);
    client.exec(readFileSync(join(process.cwd(), "schema.sql"), "utf8"));
    const insert = client.prepare(
      "INSERT INTO admin_audit_events (uid, actor_token_uid, action, target_resource_name, outcome, error_code, create_time) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    insert.run(
      "evt-1",
      null,
      "usage.record",
      "worlds/w_1",
      "SUCCESS",
      null,
      "2026-10-01T00:00:00Z",
    );
    insert.run(
      "evt-2",
      null,
      "worlds.create_quota_bypass",
      "worlds/w_2",
      "SUCCESS",
      null,
      "2026-10-02T00:00:00Z",
    );
    insert.run(
      "evt-3",
      null,
      "usage.record",
      "worlds/w_3",
      "FAILED",
      "UPSTREAM",
      "2026-10-03T00:00:00Z",
    );
    client.close();

    env = {
      DB: createTestD1(dbPath),
      WORLDS_API_URL: "http://localhost:9999",
      WORLDS_API_ADMIN_KEY: "test",
      WAZOO_PLATFORM_ADMIN_TOKEN: ADMIN_TOKEN,
      WAZOO_ENV: "test",
      GOOGLE_SERVICE_ACCOUNT_KEY: SERVICE_ACCOUNT_KEY,
    };

    const sessionRes = await app.request(
      "/v1/auth/workos-session",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${ADMIN_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: TEST_EMAIL,
          displayName: "Audit User",
          ageConfirmed: true,
        }),
      },
      env,
      executionCtx,
    );
    expect(sessionRes.status).toBe(201);
    sessionToken = ((await sessionRes.json()) as { token: string }).token;
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    // Local SQLite-backed D1 adapters may briefly hold file handles on
    // Windows; retry so temp-dir cleanup does not flake.
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

  it("rejects an unauthenticated request with 401", async () => {
    const res = await api("/v1/admin/audit-events", null, env);
    expect(res.status).toBe(401);
  });

  it("rejects a user session token with 403", async () => {
    const res = await api("/v1/admin/audit-events", sessionToken, env);
    expect(res.status).toBe(403);
  });

  it("lists events newest first with a total for the admin token", async () => {
    const res = await api("/v1/admin/audit-events", ADMIN_TOKEN, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AuditList;
    // The session mint above may record its own audit event, so assert on
    // the seeded rows' relative order rather than the exact list.
    const seeded = body.auditEvents
      .map((event) => event.uid)
      .filter((uid) => uid.startsWith("evt-"));
    expect(seeded).toEqual(["evt-3", "evt-2", "evt-1"]);
    expect(body.total).toBe(body.auditEvents.length);
  });

  it("paginates with limit and offset", async () => {
    const all = (await (
      await api("/v1/admin/audit-events", ADMIN_TOKEN, env)
    ).json()) as AuditList;
    const res = await api(
      "/v1/admin/audit-events?limit=1&offset=1",
      ADMIN_TOKEN,
      env,
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as AuditList;
    expect(page.auditEvents.map((event) => event.uid)).toEqual([
      all.auditEvents[1].uid,
    ]);
    expect(page.total).toBe(all.total);
  });

  it("rejects a limit above 100", async () => {
    const res = await api("/v1/admin/audit-events?limit=101", ADMIN_TOKEN, env);
    expect(res.status).toBe(400);
  });
});
