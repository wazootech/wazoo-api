import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createClient } from "@libsql/client";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app from "../src/index";
import type { Bindings } from "../src/env";

const ADMIN_TOKEN = "wzp_test-admin-token";
const TEST_EMAIL = "worlds-user@example.com";
const WORLDS_BASE = "http://localhost:9999";
const CREATED_UID = "w_created-123";

function makeBindings(dbPath: string): Bindings {
  return {
    TURSO_DATABASE_URL: `file:${dbPath}`,
    TURSO_AUTH_TOKEN: "",
    WORLDS_API_URL: WORLDS_BASE,
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

/** Normalizes either `fetch(request)` (Request object) or `fetch(url, init)`. */
function requestFromCall(
  input: RequestInfo | URL,
  init?: RequestInit,
): Request {
  return input instanceof Request ? input : new Request(String(input), init);
}

function worldsApiMockHandler(input: RequestInfo | URL, init?: RequestInit) {
  const req = requestFromCall(input, init);
  const url = req.url;
  const method = req.method;
  if (!url.startsWith(WORLDS_BASE)) {
    throw new Error(`unexpected fetch to ${url}`);
  }
  if (url.endsWith("/api-keys") && method === "POST") {
    return new Response(
      JSON.stringify({ uid: "key-1", token: "wzw_test-key" }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
  }
  if (url.endsWith("/worlds") && method === "POST") {
    return new Response(
      JSON.stringify({
        name: `worlds/${CREATED_UID}`,
        uid: CREATED_UID,
        displayName: "My World",
        state: "active",
        storage: "libsql-per-world",
        embeddingModel: "tfjs-universal-sentence-encoder",
        chunkSize: 1000,
        topK: 20,
        minScore: 0.0,
        createTime: new Date().toISOString(),
        updateTime: new Date().toISOString(),
      }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
  }
  if (url.endsWith(`/worlds/${CREATED_UID}`) && method === "DELETE") {
    return new Response(null, { status: 204 });
  }
  if (url.endsWith(`/worlds/${CREATED_UID}/undelete`) && method === "POST") {
    return new Response(
      JSON.stringify({ name: `worlds/${CREATED_UID}`, uid: CREATED_UID }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  return new Response(
    JSON.stringify({ error: { code: "UNEXPECTED", message: url } }),
    { status: 500, headers: { "content-type": "application/json" } },
  );
}

describe("world ownership collapse (wazoo-api#20)", () => {
  let dir: string;
  let env: Bindings;
  let sessionToken: string;
  let worldsApiMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "wazoo-api-worlds-collapse-"));
    const dbPath = join(dir, "test.db");
    const client = createClient({ url: `file:${dbPath}` });
    await client.executeMultiple(
      readFileSync(join(process.cwd(), "schema.sql"), "utf8"),
    );
    await client.close();
    env = makeBindings(dbPath);

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
          displayName: "Worlds User",
          ageConfirmed: true,
        }),
      },
      env,
    );
    expect(sessionRes.status).toBe(201);
    sessionToken = ((await sessionRes.json()) as { token: string }).token;
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
    worldsApiMock = vi.fn(worldsApiMockHandler);
    vi.stubGlobal("fetch", worldsApiMock);
  });

  it("creates a world by minting a scoped key and calling worlds-api", async () => {
    const res = await api(
      "/v1/worlds",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          worldId: "my-world",
          world: { displayName: "My World" },
        }),
      },
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      world: { uid: string; worldId: string; worldUid: string };
    };
    expect(body.world.uid).toBeTruthy();
    expect(body.world.worldId).toBe("my-world");
    expect(body.world.worldUid).toBe(CREATED_UID);

    const keyCall = worldsApiMock.mock.calls.find((call) => {
      const req = requestFromCall(call[0], call[1]);
      return req.url.endsWith("/api-keys") && req.method === "POST";
    });
    expect(keyCall).toBeTruthy();
    const keyReq = requestFromCall(keyCall![0], keyCall![1]);
    const keyBody = (await keyReq.json()) as { namespace: string };
    expect(keyBody.namespace).toBeTruthy();

    const worldCall = worldsApiMock.mock.calls.find((call) => {
      const req = requestFromCall(call[0], call[1]);
      return req.url.endsWith("/worlds") && req.method === "POST";
    });
    expect(worldCall).toBeTruthy();
    const worldReq = requestFromCall(worldCall![0], worldCall![1]);
    expect(worldReq.headers.get("Authorization")).toBe("Bearer wzw_test-key");

    const client = createClient({ url: env.TURSO_DATABASE_URL });
    const rs = await client.execute({
      sql: "SELECT worlds_api_uid, turso_database_url FROM worlds WHERE world_id = 'my-world'",
    });
    await client.close();
    expect(rs.rows.length).toBe(1);
    expect(rs.rows[0].worlds_api_uid).toBe(CREATED_UID);
    expect(rs.rows[0].turso_database_url).toBeNull();
  });

  it("deletes via worlds-api by world_uid and mirrors state locally", async () => {
    const create = await api(
      "/v1/worlds",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          worldId: "del-world",
          world: { displayName: "Del World" },
        }),
      },
      env,
    );
    expect(create.status).toBe(201);

    const res = await api(
      "/v1/worlds/del-world",
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${sessionToken}` },
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { world: { state: string } };
    expect(body.world.state).toBe("DELETED");

    const deleteCall = worldsApiMock.mock.calls.find((call) => {
      const req = requestFromCall(call[0], call[1]);
      return (
        req.url.includes(`/worlds/${CREATED_UID}`) && req.method === "DELETE"
      );
    });
    expect(deleteCall).toBeTruthy();
  });

  it("returns 502 when worlds-api create fails", async () => {
    worldsApiMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ uid: "key-1", token: "wzw_test-key" }), {
          status: 201,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: "PROVISIONING_FAILED", message: "turso down" },
          }),
          { status: 502 },
        ),
      );

    const res = await api(
      "/v1/worlds",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          worldId: "fail-world",
          world: { displayName: "Fail World" },
        }),
      },
      env,
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("WORLD_PROVISIONING_FAILED");
    expect(body.error.message).toContain("turso down");
  });
});
