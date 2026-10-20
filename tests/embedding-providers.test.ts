import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app from "../src/index";
import type { Bindings } from "../src/env";

import { createTestD1, type TestD1 } from "./helpers/d1-test-adapter";

const ADMIN_TOKEN = "wzp_test-admin-token";
const WORLDS_ADMIN_KEY = "worlds-admin-key-for-tests";
const SECRET_KEY = "sk-test-0123456789abcdefghijklmnop";

type TestBindings = Bindings & { DB: TestD1 };

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

function headers(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function mintSession(env: Bindings, email: string) {
  const res = await api(
    "/v1/auth/workos-session",
    {
      method: "POST",
      headers: headers(ADMIN_TOKEN),
      body: JSON.stringify({ email, displayName: "T", ageConfirmed: true }),
    },
    env,
  );
  expect(res.status).toBe(201);
  const { token } = (await res.json()) as { token: string };
  const me = await api("/v1/users/me", { headers: headers(token) }, env);
  const { user } = (await me.json()) as { user: { uid: string } };
  return { token, uid: user.uid };
}

describe("BYOK embedding provider credentials (wazoo-api#123)", () => {
  let dir: string;
  let env: Bindings;
  let alice: { token: string; uid: string };
  let bob: { token: string; uid: string };
  let upstream: ReturnType<typeof vi.fn>;
  let logged: string[];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "wazoo-api-byok-"));
    const dbPath = join(dir, "test.db");
    const client = new DatabaseSync(dbPath);
    client.exec(readFileSync(join(process.cwd(), "schema.sql"), "utf8"));
    client.close();
    env = {
      DB: createTestD1(dbPath),
      WORLDS_API_URL: "http://localhost:9999",
      WORLDS_API_ADMIN_KEY: WORLDS_ADMIN_KEY,
      WAZOO_PLATFORM_ADMIN_TOKEN: ADMIN_TOKEN,
      WAZOO_ENV: "test",
    } as TestBindings;

    alice = await mintSession(env, "alice@example.com");
    bob = await mintSession(env, "bob@example.com");

    logged = [];
    for (const m of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, m).mockImplementation((...a) => {
        logged.push(a.map(String).join(" "));
      });
    }
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
    } catch {
      // Best-effort cleanup of the temp directory.
    }
  });

  function stubUpstream(status: number, body?: unknown) {
    upstream = vi.fn().mockResolvedValue(
      body === undefined
        ? new Response(null, { status })
        : new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          }),
    );
    vi.stubGlobal("fetch", upstream);
  }

  const meta = (provider: string) => ({
    provider,
    status: "active",
    fingerprint: "3f9a1c2e",
    last4: "mnop",
    createTime: "2026-10-20T00:00:00.000Z",
  });

  it("PUT forwards the caller's own namespace and the admin key, never the wzp_ token", async () => {
    stubUpstream(200, meta("openai"));
    const res = await api(
      "/v1/users/me/embedding-providers/openai",
      {
        method: "PUT",
        headers: headers(alice.token),
        body: JSON.stringify({ apiKey: SECRET_KEY }),
      },
      env,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).provider).toBe("openai");

    const [url, init] = upstream.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `http://localhost:9999/namespaces/${alice.uid}/embedding-providers/openai`,
    );
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${WORLDS_ADMIN_KEY}`,
    );
    expect(JSON.stringify(init)).not.toContain(alice.token);
    expect(JSON.parse(init.body as string)).toEqual({ apiKey: SECRET_KEY });
  });

  it("another customer's namespace is unreachable: the path never takes a namespace", async () => {
    stubUpstream(404, { error: { code: "NOT_FOUND", message: "none" } });
    const res = await api(
      "/v1/users/me/embedding-providers/openai",
      { headers: headers(bob.token) },
      env,
    );
    expect(res.status).toBe(404);
    const [url] = upstream.mock.calls[0] as [string];
    expect(url).toContain(`/namespaces/${bob.uid}/`);
    expect(url).not.toContain(alice.uid);
  });

  it("the key never appears in a response or a log line", async () => {
    stubUpstream(200, meta("openrouter"));
    const res = await api(
      "/v1/users/me/embedding-providers/openrouter",
      {
        method: "PUT",
        headers: headers(alice.token),
        body: JSON.stringify({ apiKey: SECRET_KEY }),
      },
      env,
    );
    expect(await res.text()).not.toContain(SECRET_KEY);
    expect(logged.join("\n")).not.toContain(SECRET_KEY);
  });

  it("lists credentials through the caller's namespace", async () => {
    stubUpstream(200, { providers: [meta("openai"), meta("openrouter")] });
    const res = await api(
      "/v1/users/me/embedding-providers",
      { headers: headers(alice.token) },
      env,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).providers).toHaveLength(2);
    expect((upstream.mock.calls[0] as [string])[0]).toBe(
      `http://localhost:9999/namespaces/${alice.uid}/embedding-providers`,
    );
  });

  it("DELETE revokes one provider and returns 204", async () => {
    stubUpstream(204);
    const res = await api(
      "/v1/users/me/embedding-providers/openai",
      { method: "DELETE", headers: headers(alice.token) },
      env,
    );
    expect(res.status).toBe(204);
    const [url, init] = upstream.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith("/embedding-providers/openai")).toBe(true);
    expect(init.method).toBe("DELETE");
  });

  it("rejects an unknown provider and a malformed key before calling worlds-api", async () => {
    stubUpstream(200, meta("openai"));
    const badProvider = await api(
      "/v1/users/me/embedding-providers/cohere",
      {
        method: "PUT",
        headers: headers(alice.token),
        body: JSON.stringify({ apiKey: SECRET_KEY }),
      },
      env,
    );
    expect(badProvider.status).toBe(400);

    for (const apiKey of ["short", "has space in the key 0123456789", ""]) {
      const bad = await api(
        "/v1/users/me/embedding-providers/openai",
        {
          method: "PUT",
          headers: headers(alice.token),
          body: JSON.stringify({ apiKey }),
        },
        env,
      );
      expect(bad.status).toBe(400);
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it("passes worlds-api errors through, including a missing KEK as 503", async () => {
    stubUpstream(503, {
      error: { code: "EMBEDDINGS_NOT_CONFIGURED", message: "off" },
    });
    const res = await api(
      "/v1/users/me/embedding-providers/openai",
      {
        method: "PUT",
        headers: headers(alice.token),
        body: JSON.stringify({ apiKey: SECRET_KEY }),
      },
      env,
    );
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error.code).toBe(
      "EMBEDDINGS_NOT_CONFIGURED",
    );
  });

  it("requires authentication and a user token", async () => {
    stubUpstream(200, { providers: [] });
    const anon = await api("/v1/users/me/embedding-providers", {}, env);
    expect(anon.status).toBe(401);
    // The env admin token has no namespace of its own.
    const admin = await api(
      "/v1/users/me/embedding-providers",
      { headers: headers(ADMIN_TOKEN) },
      env,
    );
    expect(admin.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });
});
