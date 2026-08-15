import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app from "../src/index";
import type { Bindings } from "../src/env";
import {
  SESSION_DEFAULT_SCOPES,
  TOKEN_DEFAULT_SCOPES,
} from "../src/lib/scopes";

// Must start with wzp_ so requireAuth accepts it before comparing to the
// env admin token.
const ADMIN_TOKEN = "wzp_test-admin-token";
const TEST_EMAIL = "beta-user@example.com";

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

describe("platform token scopes (wazoo-api#13 / wazoo-api#14)", () => {
  let dir: string;
  let env: Bindings;
  let sessionToken: string;
  let readOnlyToken: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "wazoo-api-token-scopes-"));
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
        headers: {
          authorization: `Bearer ${ADMIN_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: TEST_EMAIL,
          displayName: "Beta User",
          ageConfirmed: true,
        }),
      },
      env,
    );
    expect(sessionRes.status).toBe(201);
    const sessionBody = (await sessionRes.json()) as {
      token: string;
      expiresAt: string;
    };
    sessionToken = sessionBody.token;
    expect(sessionToken.startsWith("wzp_")).toBe(true);
    expect(sessionBody.expiresAt).toBeTruthy();

    // Mint a token that lacks users.write (negative control).
    const limitedRes = await api(
      "/v1/auth/api-tokens",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${ADMIN_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: TEST_EMAIL,
          tokenName: "read-only",
          scope: "users.read",
        }),
      },
      env,
    );
    expect(limitedRes.status).toBe(201);
    readOnlyToken = ((await limitedRes.json()) as { token: string }).token;
  });

  afterAll(() => {
    // Libsql clients opened inside the app may briefly hold file handles on
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

  it("session scopes include users.write; new-token defaults do not", () => {
    expect(SESSION_DEFAULT_SCOPES.split(/\s+/)).toContain("users.write");
    expect(TOKEN_DEFAULT_SCOPES.split(/\s+/)).not.toContain("users.write");
  });

  it("lets the console session token create an API token", async () => {
    const res = await api(
      "/v1/auth/api-tokens",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ tokenName: "ci-token", scope: "worlds.read" }),
      },
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      uid: string;
      name: string;
      token: string;
    };
    expect(body.name).toBe("ci-token");
    expect(body.token.startsWith("wzp_")).toBe(true);
  });

  it("lets the console session token revoke an API token", async () => {
    const created = await api(
      "/v1/auth/api-tokens",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ tokenName: "revoke-me", scope: "worlds.read" }),
      },
      env,
    );
    expect(created.status).toBe(201);

    const del = await api(
      "/v1/auth/api-tokens/revoke-me",
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${sessionToken}` },
      },
      env,
    );
    expect(del.status).toBe(200);
    expect(((await del.json()) as { token: string }).token).toBe("revoke-me");
  });

  it("still denies create to tokens without users.write", async () => {
    const res = await api(
      "/v1/auth/api-tokens",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${readOnlyToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ tokenName: "nope", scope: "worlds.read" }),
      },
      env,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("PERMISSION_DENIED");
  });

  it("still denies revoke to tokens without users.write", async () => {
    const res = await api(
      "/v1/auth/api-tokens/revoke-me",
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${readOnlyToken}` },
      },
      env,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("PERMISSION_DENIED");
  });

  it("returns 403 NOT_ALLOWLISTED for non-approved email on login", async () => {
    const res = await api(
      "/v1/auth/login",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "unapproved-user@example.com" }),
      },
      env,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("NOT_ALLOWLISTED");
  });
});
