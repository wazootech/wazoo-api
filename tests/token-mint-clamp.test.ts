import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app from "../src/index";
import type { Bindings } from "../src/env";
import { createTestD1 } from "./helpers/d1-test-adapter";

// Fake fixture values only (memory#67).
const ADMIN = "wzp_test-admin-token";
const EMAIL = "clamp-user@example.com";
const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

describe("token minting is clamped to the presenting token (memory#67)", () => {
  let dir: string;
  let env: Bindings;

  const post = (token: string, body: Record<string, unknown>) =>
    Promise.resolve(
      app.request(
        "/v1/auth/api-tokens",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
        env,
        ctx,
      ),
    );

  const mint = async (body: Record<string, unknown>) => {
    const res = await post(ADMIN, { email: EMAIL, ...body });
    expect(res.status).toBe(201);
    return ((await res.json()) as { token: string }).token;
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "wazoo-api-mint-clamp-"));
    const dbPath = join(dir, "test.db");
    const client = new DatabaseSync(dbPath);
    client.exec(readFileSync(join(process.cwd(), "schema.sql"), "utf8"));
    client.close();
    env = {
      DB: createTestD1(dbPath),
      WORLDS_API_URL: "http://localhost:9999",
      WORLDS_API_ADMIN_KEY: "test",
      WAZOO_PLATFORM_ADMIN_TOKEN: ADMIN,
      WAZOO_ENV: "test",
    } as Bindings;
    const seeded = await Promise.resolve(
      app.request(
        "/v1/auth/workos-session",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${ADMIN}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            email: EMAIL,
            displayName: "Clamp User",
            ageConfirmed: true,
          }),
        },
        env,
        ctx,
      ),
    );
    expect(seeded.status).toBe(201);
  });

  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
    } catch {
      // Best-effort temp cleanup.
    }
  });

  it("rejects scopes the presenting token does not hold", async () => {
    const narrow = await mint({ tokenName: "n1", scope: "users.write" });
    const res = await post(narrow, {
      tokenName: "wide",
      scope: "users.read users.write worlds.write",
    });
    expect(res.status).toBe(403);
  });

  it("allows a subset of the presenting token's scopes", async () => {
    const t = await mint({ tokenName: "n2", scope: "users.write worlds.read" });
    const res = await post(t, { tokenName: "sub", scope: "worlds.read" });
    expect(res.status).toBe(201);
  });

  it("narrows omitted scope to what the caller holds", async () => {
    const t = await mint({ tokenName: "n3", scope: "users.write worlds.read" });
    const res = await post(t, { tokenName: "dflt" });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare(
      "SELECT scope FROM platform_api_tokens WHERE name = ?",
    )
      .bind("dflt")
      .first<{ scope: string }>();
    expect(row?.scope).toBe("worlds.read");
  });

  it("does not let an expiring token mint a longer-lived or non-expiring one", async () => {
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const later = new Date(Date.now() + 86_400_000).toISOString();
    const t = await mint({
      tokenName: "n4",
      scope: "users.write worlds.read",
      expiresAt: soon,
    });
    expect(
      (
        await post(t, {
          tokenName: "x1",
          scope: "worlds.read",
          expiresAt: later,
        })
      ).status,
    ).toBe(403);
    const inherit = await post(t, { tokenName: "x2", scope: "worlds.read" });
    expect(inherit.status).toBe(201);
    const row = await env.DB.prepare(
      "SELECT expires_at FROM platform_api_tokens WHERE name = ?",
    )
      .bind("x2")
      .first<{ expires_at: string }>();
    expect(row?.expires_at).toBe(soon);
    expect(
      (
        await post(t, {
          tokenName: "x3",
          scope: "worlds.read",
          expiresAt: soon,
        })
      ).status,
    ).toBe(201);
  });

  it("leaves the admin token unrestricted", async () => {
    const res = await post(ADMIN, {
      email: EMAIL,
      tokenName: "adm",
      scope: "worlds.read made.up",
    });
    expect(res.status).toBe(201);
  });
});
