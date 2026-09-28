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

import { createTestD1, type TestD1 } from "./helpers/d1-test-adapter";

const ADMIN_TOKEN = "wzp_test-admin-token";
const TEST_EMAIL = "worlds-user@example.com";
const WORLDS_BASE = "http://localhost:9999";
const CREATED_WORLD_ID = "w_00000000-0000-4000-8000-000000000001";

type TestBindings = Bindings & { DB: TestD1 };

function makeBindings(dbPath: string): TestBindings {
  return {
    DB: createTestD1(dbPath),
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

let createdCounter = 0;
let lastCreatedWorldId = CREATED_WORLD_ID;

function worldsApiMockHandler(input: RequestInfo | URL, init?: RequestInit) {
  const req = requestFromCall(input, init);
  const url = req.url;
  const method = req.method;
  if (!url.startsWith(WORLDS_BASE)) {
    throw new Error(`unexpected fetch to ${url}`);
  }
  if (new URL(url).pathname === "/api-keys" && method === "GET") {
    return new Response(
      JSON.stringify({
        keys: [
          {
            id: "key-1",
            name: "test-key",
            namespace: "test-namespace",
            worldId: lastCreatedWorldId,
            scopes: ["data:read", "data:write"],
            createTime: new Date().toISOString(),
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  if (url.endsWith("/api-keys") && method === "POST") {
    return new Response(
      JSON.stringify({
        id: "key-1",
        token: "wzw_test-key",
        name: "test-key",
        namespace: "test-namespace",
        worldId: lastCreatedWorldId,
        createTime: new Date().toISOString(),
      }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
  }
  if (url.endsWith("/api-keys/key-1") && method === "DELETE") {
    return new Response(null, { status: 204 });
  }
  if (url.endsWith("/worlds") && method === "POST") {
    // Canonical ids are minted by the data plane and unique per world.
    lastCreatedWorldId = `w_00000000-0000-4000-8000-${String(++createdCounter).padStart(12, "0")}`;
    return new Response(
      JSON.stringify({
        id: lastCreatedWorldId,
        displayName: "My World",
        state: "active",
        storage: "d1-world",
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
  if (url.endsWith(`/worlds/${lastCreatedWorldId}`) && method === "DELETE") {
    return new Response(null, { status: 204 });
  }
  if (
    url.endsWith(`/worlds/${lastCreatedWorldId}/undelete`) &&
    method === "POST"
  ) {
    return new Response(JSON.stringify({ id: lastCreatedWorldId }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
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
    const client = new DatabaseSync(dbPath);
    client.exec(readFileSync(join(process.cwd(), "schema.sql"), "utf8"));
    client.close();
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
          world: { displayName: "My World" },
        }),
      },
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      world: { id: string; displayName: string };
    };
    expect(body.world.id).toBe(lastCreatedWorldId);
    expect(body.world.displayName).toBe("My World");
    expect(body.world).not.toHaveProperty("name");
    expect(body.world).not.toHaveProperty("worldId");
    expect(body.world).not.toHaveProperty("slug");

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

    const client = new DatabaseSync((env.DB as TestD1).path);
    const rs = client
      .prepare("SELECT world_id FROM worlds WHERE world_id = ?")
      .all(lastCreatedWorldId);
    client.close();
    expect(rs.length).toBe(1);
    expect(rs[0].world_id).toBe(lastCreatedWorldId);

    const tokenRes = await api(
      `/v1/worlds/${lastCreatedWorldId}/auth/tokens`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "test-world-key" }),
      },
      env,
    );
    expect(tokenRes.status).toBe(201);
    const tokenBody = (await tokenRes.json()) as {
      token: { id: string; token: string; worldId: string };
    };
    expect(tokenBody.token).toMatchObject({
      id: "key-1",
      token: "wzw_test-key",
      worldId: lastCreatedWorldId,
    });
    expect(tokenBody.token).not.toHaveProperty("tokenId");

    const revokeRes = await api(
      `/v1/worlds/${lastCreatedWorldId}/auth/tokens/${tokenBody.token.id}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${sessionToken}` },
      },
      env,
    );
    expect(revokeRes.status).toBe(204);
    const revokeCall = worldsApiMock.mock.calls.find((call) => {
      const req = requestFromCall(call[0], call[1]);
      return req.url.endsWith("/api-keys/key-1") && req.method === "DELETE";
    });
    expect(revokeCall).toBeTruthy();
  });

  it("returns 400 when callers supply a world ID or slug", async () => {
    for (const world of [
      { displayName: "My World", id: CREATED_WORLD_ID },
      { displayName: "My World", slug: "my-world" },
    ]) {
      const response = await api(
        "/v1/worlds",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${sessionToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ world }),
        },
        env,
      );
      expect(response.status).toBe(400);
    }
    expect(worldsApiMock).not.toHaveBeenCalled();
  });

  it("requires the owning user even for a valid minted world ID", async () => {
    const worldId = "w_00000000-0000-4000-8000-000000000777";
    const database = new DatabaseSync((env.DB as TestD1).path);
    const owner = database
      .prepare("SELECT user_id FROM users WHERE email = ?")
      .get(TEST_EMAIL) as { user_id: string };
    database
      .prepare(
        "INSERT INTO worlds (world_id, user_id, display_name) VALUES (?, ?, ?)",
      )
      .run(worldId, owner.user_id, "Private world");
    database.close();

    const otherSession = await api(
      "/v1/auth/workos-session",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${ADMIN_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "other-world-owner@example.com",
          displayName: "Other Owner",
          ageConfirmed: true,
        }),
      },
      env,
    );
    expect(otherSession.status).toBe(201);
    const { token } = (await otherSession.json()) as { token: string };

    const response = await api(
      `/v1/worlds/${worldId}`,
      { headers: { authorization: `Bearer ${token}` } },
      env,
    );
    expect(response.status).toBe(404);
  });

  it("returns 409 when worlds-api returns an existing world ID", async () => {
    const existingWorldId = "w_00000000-0000-4000-8000-000000000099";
    const database = new DatabaseSync((env.DB as TestD1).path);
    const user = database
      .prepare("SELECT user_id FROM users WHERE email = ?")
      .get(TEST_EMAIL) as { user_id: string };
    database
      .prepare(
        "INSERT INTO worlds (world_id, user_id, display_name) VALUES (?, ?, ?)",
      )
      .run(existingWorldId, user.user_id, "Existing world");
    database.close();

    const timestamp = new Date().toISOString();
    worldsApiMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "provision-key",
            token: "wzw_provision-key",
            name: "provision",
            namespace: "test-user",
            createTime: timestamp,
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: existingWorldId }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );

    const response = await api(
      "/v1/worlds",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ world: { displayName: "Duplicate world" } }),
      },
      env,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "ALREADY_EXISTS" },
    });
  });

  it("rejects worlds-api responses without canonical IDs", async () => {
    worldsApiMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "provision-key",
            token: "wzw_provision-key",
            name: "provision",
            namespace: "test-user",
            worldId: null,
            createTime: new Date().toISOString(),
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "legacy-world" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );

    const failedWorld = await api(
      "/v1/worlds",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          world: { displayName: "Legacy ID World" },
        }),
      },
      env,
    );
    expect(failedWorld.status).toBe(502);
    expect(await failedWorld.json()).toMatchObject({
      error: { code: "WORLD_PROVISIONING_FAILED" },
    });

    const database = new DatabaseSync((env.DB as TestD1).path);
    expect(
      database
        .prepare("SELECT world_id FROM worlds WHERE world_id = ?")
        .all("legacy-id-world"),
    ).toEqual([]);
    database.close();

    const created = await api(
      "/v1/worlds",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          world: { displayName: "Legacy Token World" },
        }),
      },
      env,
    );
    expect(created.status).toBe(201);
    const worldId = ((await created.json()) as { world: { id: string } }).world
      .id;
    const timestamp = new Date().toISOString();

    worldsApiMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          keys: [
            {
              apiKeyId: "legacy-key",
              name: "legacy key",
              namespace: "test-user",
              worldId,
              scopes: ["data:read"],
              createTime: timestamp,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const listed = await api(
      `/v1/worlds/${worldId}/auth/tokens`,
      { headers: { authorization: `Bearer ${sessionToken}` } },
      env,
    );
    expect(listed.status).toBe(502);
    expect(await listed.json()).toMatchObject({
      error: {
        message: "worlds-api returned API keys without canonical id fields",
      },
    });

    worldsApiMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          apiKeyId: "legacy-key",
          token: "wzw_legacy-key",
          name: "legacy key",
          namespace: "test-user",
          worldId,
          createTime: timestamp,
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    const createdToken = await api(
      `/v1/worlds/${worldId}/auth/tokens`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "legacy key" }),
      },
      env,
    );
    expect(createdToken.status).toBe(502);
    expect(await createdToken.json()).toMatchObject({
      error: {
        message: "worlds-api returned an API key without canonical id fields",
      },
    });
  });

  it("does not revoke a token scoped to a different world", async () => {
    const created = await api(
      "/v1/worlds",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ world: { displayName: "Owner World" } }),
      },
      env,
    );
    expect(created.status).toBe(201);

    worldsApiMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          keys: [
            {
              id: "other-world-key",
              name: "other-world-key",
              namespace: "test-namespace",
              worldId: "w_00000000-0000-4000-8000-000000000002",
              scopes: ["data:read"],
              createTime: new Date().toISOString(),
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const revoke = await api(
      `/v1/worlds/${lastCreatedWorldId}/auth/tokens/other-world-key`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${sessionToken}` },
      },
      env,
    );
    expect(revoke.status).toBe(404);
    expect(
      worldsApiMock.mock.calls.some((call) => {
        const req = requestFromCall(call[0], call[1]);
        return (
          req.method === "DELETE" &&
          req.url.endsWith("/api-keys/other-world-key")
        );
      }),
    ).toBe(false);
  });

  it("returns world-token id and revokes by that ID", async () => {
    const created = await api(
      "/v1/worlds",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          world: { displayName: "Token World" },
        }),
      },
      env,
    );
    expect(created.status).toBe(201);

    const tokenRes = await api(
      `/v1/worlds/${lastCreatedWorldId}/auth/tokens`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "test-key" }),
      },
      env,
    );
    expect(tokenRes.status).toBe(201);
    const { token } = (await tokenRes.json()) as {
      token: { id: string; token: string; worldId: string };
    };
    expect(token.id).toBe("key-1");
    expect(token.token).toBe("wzw_test-key");
    expect(token.worldId).toBe(lastCreatedWorldId);
    expect(token).not.toHaveProperty("tokenId");

    const revoke = await api(
      `/v1/worlds/${lastCreatedWorldId}/auth/tokens/${token.id}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${sessionToken}` },
      },
      env,
    );
    expect(revoke.status).toBe(204);
  });

  it("deletes via worlds-api by canonical world_id and mirrors state locally", async () => {
    const create = await api(
      "/v1/worlds",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          world: { displayName: "Del World" },
        }),
      },
      env,
    );
    expect(create.status).toBe(201);

    const res = await api(
      `/v1/worlds/${lastCreatedWorldId}`,
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
        req.url.includes(`/worlds/${lastCreatedWorldId}`) &&
        req.method === "DELETE"
      );
    });
    expect(deleteCall).toBeTruthy();
  });

  it("returns 502 when worlds-api create fails", async () => {
    worldsApiMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "key-1",
            token: "wzw_test-key",
            name: "test-world-key",
            namespace: "test-user",
            worldId: lastCreatedWorldId,
            createTime: new Date().toISOString(),
          }),
          {
            status: 201,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "PROVISIONING_FAILED",
              message: "data plane unavailable",
            },
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
    expect(body.error.message).toContain("data plane unavailable");
  });
});
