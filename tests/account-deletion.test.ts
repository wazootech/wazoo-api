import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app from "../src/index";
import type { Bindings } from "../src/env";

const ADMIN_TOKEN = "wzp_test-admin-token";
const TEST_EMAIL = "delete-me@example.com";

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

describe("account deletion and data export (wazoo-api#26)", () => {
  let dir: string;
  let env: Bindings;
  let sessionToken: string;
  let userUid: string;
  let worldsApiFetch: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "wazoo-api-deletion-"));
    const dbPath = join(dir, "test.db");
    const client = createClient({ url: `file:${dbPath}` });
    await client.executeMultiple(
      readFileSync(join(process.cwd(), "schema.sql"), "utf8"),
    );
    await client.close();
    env = makeBindings(dbPath);

    // Mint a console session token through the real admin-gated endpoint.
    const sessionRes = await api(
      "/v1/auth/workos-session",
      {
        method: "POST",
        headers: authHeaders(ADMIN_TOKEN),
        body: JSON.stringify({
          email: TEST_EMAIL,
          displayName: "Delete Me",
          ageConfirmed: true,
        }),
      },
      env,
    );
    expect(sessionRes.status).toBe(201);
    sessionToken = ((await sessionRes.json()) as { token: string }).token;
    expect(sessionToken.startsWith("wzp_")).toBe(true);

    // Look up the minted user's uid.
    const me = await api(
      "/v1/users/me",
      { headers: authHeaders(sessionToken) },
      env,
    );
    userUid = ((await me.json()) as { user: { uid: string } }).user.uid;

    // Seed a world row + usage event so export has data and deletion cascades.
    const seed = createClient({ url: `file:${dbPath}` });
    const ts = new Date().toISOString();
    await seed.execute({
      sql: "INSERT INTO worlds (uid, user_uid, world_id, display_name, state, create_time, update_time) VALUES (?, ?, ?, ?, 'active', ?, ?)",
      args: ["w_del_mirror", userUid, "del-world", "Del World", ts, ts],
    });
    await seed.execute({
      sql: "INSERT INTO usage_events (uid, user_uid, world_uid, metric, quantity, unit, create_time) VALUES (?, ?, ?, 'requests', 5, 'request', ?)",
      args: ["u_del_1", userUid, "w_del_mirror", ts],
    });
    await seed.close();

    // Stub the worlds-api namespace-delete call.
    worldsApiFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ deletedWorlds: 1, revokedKeys: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", worldsApiFetch);
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

  it("exports the data held on the user", async () => {
    const res = await api(
      "/v1/users/me/export",
      { headers: authHeaders(sessionToken) },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { email: string };
      worlds: Array<{ worldId: string }>;
      usageEvents: Array<{ metric: string }>;
      apiTokens: unknown[];
    };
    expect(body.user.email).toBe(TEST_EMAIL);
    expect(body.worlds).toHaveLength(1);
    expect(body.worlds[0].worldId).toBe("del-world");
    expect(body.usageEvents).toHaveLength(1);
    expect(body.usageEvents[0].metric).toBe("requests");
    expect(body.apiTokens.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects delete with an unknown confirmation token", async () => {
    const res = await api(
      "/v1/users/me",
      {
        method: "DELETE",
        headers: authHeaders(sessionToken),
        body: JSON.stringify({ confirmationToken: "wzdel_bogus" }),
      },
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_ARGUMENT");
  });

  it("completes the two-step deletion: marks worlds, removes user and cascades", async () => {
    const init = await api(
      "/v1/users/me/deletion",
      { method: "POST", headers: authHeaders(sessionToken) },
      env,
    );
    expect(init.status).toBe(201);

    // The raw confirmation token is never exposed by the API; forge one by
    // hashing a known value the same way the route hashes it, then confirm.
    const { sha256Hex } = await import("../src/lib/crypto");
    const rawToken = "wzdel_test-confirm-token";
    const hash = await sha256Hex(rawToken);

    const client = createClient({ url: `file:${env.TURSO_DATABASE_URL}` });
    const ts = new Date(Date.now() + 60_000).toISOString();
    await client.execute({
      sql: "INSERT INTO deletion_requests (uid, user_uid, token_hash, expires_at) VALUES (?, ?, ?, ?)",
      args: ["wzdel_request_2", userUid, hash, ts],
    });
    await client.close();

    const del = await api(
      "/v1/users/me",
      {
        method: "DELETE",
        headers: authHeaders(sessionToken),
        body: JSON.stringify({ confirmationToken: rawToken }),
      },
      env,
    );
    expect(del.status).toBe(204);

    // worlds-api was told to mark the user's namespace deleted.
    const worldsCall = worldsApiFetch.mock.calls.find((call) => {
      const req =
        call[0] instanceof Request
          ? call[0]
          : new Request(String(call[0]), call[1]);
      return (
        req.url ===
          `http://localhost:9999/admin/namespaces/${userUid}/delete` &&
        req.method === "POST"
      );
    });
    expect(worldsCall).toBeTruthy();

    // The user row is gone; world mirror + usage events cascaded away.
    const check = createClient({ url: `file:${env.TURSO_DATABASE_URL}` });
    const userRows = await check.execute({
      sql: "SELECT uid FROM users WHERE uid = ?",
      args: [userUid],
    });
    const worldRows = await check.execute({
      sql: "SELECT uid FROM worlds WHERE uid = 'w_del_mirror'",
    });
    const usageRows = await check.execute({
      sql: "SELECT uid FROM usage_events WHERE uid = 'u_del_1'",
    });
    const tokenRows = await check.execute({
      sql: "SELECT uid FROM platform_api_tokens WHERE user_uid = ?",
      args: [userUid],
    });
    const reqRows = await check.execute({
      sql: "SELECT uid FROM deletion_requests WHERE user_uid = ?",
      args: [userUid],
    });
    await check.close();
    expect(userRows.rows).toHaveLength(0);
    expect(worldRows.rows).toHaveLength(0);
    expect(usageRows.rows).toHaveLength(0);
    expect(tokenRows.rows).toHaveLength(0);
    expect(reqRows.rows).toHaveLength(0);
  });
});
