import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app from "../src/index";
import type { Bindings } from "../src/env";

const ADMIN_TOKEN = "wzp_test-admin-token";

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

async function workosSession(
  body: Record<string, unknown>,
  env: Bindings,
): Promise<Response> {
  return api(
    "/v1/auth/workos-session",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${ADMIN_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
    env,
  );
}

describe("age gate / COPPA affirmation (wazoo-api#27)", () => {
  let dir: string;
  let env: Bindings;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "wazoo-api-age-gate-"));
    const dbPath = join(dir, "test.db");
    const client = createClient({ url: `file:${dbPath}` });
    await client.executeMultiple(
      readFileSync(join(process.cwd(), "schema.sql"), "utf8"),
    );
    await client.close();
    env = makeBindings(dbPath);
  });

  afterAll(() => {
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

  it("rejects new-user creation without age confirmation", async () => {
    const res = await workosSession(
      { email: "no-age@example.com", displayName: "No Age" },
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AGE_GATE_REQUIRED");
  });

  it("rejects new-user creation with an explicit false affirmation", async () => {
    const res = await workosSession(
      {
        email: "under-13@example.com",
        displayName: "Under 13",
        ageConfirmed: false,
      },
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AGE_GATE_REQUIRED");
  });

  it("creates a user when age is confirmed and persists the timestamp", async () => {
    const res = await workosSession(
      {
        email: "beta-user@example.com",
        displayName: "Beta User",
        ageConfirmed: true,
      },
      env,
    );
    expect(res.status).toBe(201);
    expect(
      ((await res.json()) as { token: string }).token.startsWith("wzp_"),
    ).toBe(true);

    const client = createClient({ url: `file:${env.TURSO_DATABASE_URL}` });
    const row = await client.execute({
      sql: "SELECT age_confirmed_at FROM users WHERE email = ?",
      args: ["beta-user@example.com"],
    });
    await client.close();
    expect(
      (row.rows[0] as Record<string, unknown> | undefined)?.age_confirmed_at,
    ).toBeTruthy();
  });

  it("does not re-gate an existing user (magic-link flow continues)", async () => {
    const res = await workosSession(
      { email: "beta-user@example.com", displayName: "Beta User" },
      env,
    );
    expect(res.status).toBe(201);
    expect(
      ((await res.json()) as { token: string }).token.startsWith("wzp_"),
    ).toBe(true);
  });
});
