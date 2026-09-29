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
  if (url.endsWith("/api-keys") && method === "POST") {
    return new Response(
      JSON.stringify({ uid: "key-1", token: "wzw_test-key" }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
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
    return new Response(
      JSON.stringify({
        name: `worlds/${lastCreatedWorldId}`,
        uid: lastCreatedWorldId,
      }),
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
    expect(body.world).not.toHaveProperty("uid");
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
    expect(await worldReq.json()).toEqual({ displayName: "My World" });

    const client = new DatabaseSync((env.DB as TestD1).path);
    const rs = client
      .prepare("SELECT world_id FROM worlds WHERE world_id = ?")
      .all(lastCreatedWorldId);
    client.close();
    expect(rs.length).toBe(1);
    expect(rs[0].world_id).toBe(lastCreatedWorldId);
  });

  it("fails closed when worlds-api returns the legacy uid field", async () => {
    worldsApiMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ uid: "key-1", token: "wzw_test-key" }), {
          status: 201,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            uid: "w_00000000-0000-4000-8000-000000000002",
          }),
          { status: 201, headers: { "content-type": "application/json" } },
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
        body: JSON.stringify({ world: { displayName: "Legacy Response" } }),
      },
      env,
    );

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("WORLD_PROVISIONING_FAILED");
  });

  it("returns 409 when worlds-api returns an ID already used by another owner", async () => {
    const first = await api(
      "/v1/worlds",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ world: { displayName: "First World" } }),
      },
      env,
    );
    expect(first.status).toBe(201);
    const duplicateWorldId = lastCreatedWorldId;

    const otherSession = await api(
      "/v1/auth/workos-session",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${ADMIN_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "other-worlds-user@example.com",
          displayName: "Other Worlds User",
          ageConfirmed: true,
        }),
      },
      env,
    );
    expect(otherSession.status).toBe(201);
    const otherToken = ((await otherSession.json()) as { token: string }).token;

    worldsApiMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ uid: "key-2", token: "wzw_test-key-2" }),
          {
            status: 201,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: duplicateWorldId }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );

    const duplicate = await api(
      "/v1/worlds",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${otherToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ world: { displayName: "Duplicate World" } }),
      },
      env,
    );

    expect(duplicate.status).toBe(409);
    const body = (await duplicate.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ALREADY_EXISTS");
  });

  it("keeps world reads scoped to the authenticated owner", async () => {
    const created = await api(
      "/v1/worlds",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ world: { displayName: "Owned World" } }),
      },
      env,
    );
    expect(created.status).toBe(201);

    const otherSession = await api(
      "/v1/auth/workos-session",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${ADMIN_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "non-owner@example.com",
          displayName: "Non-owner",
          ageConfirmed: true,
        }),
      },
      env,
    );
    expect(otherSession.status).toBe(201);
    const otherToken = ((await otherSession.json()) as { token: string }).token;

    const get = await api(
      `/v1/worlds/${lastCreatedWorldId}`,
      { headers: { authorization: `Bearer ${otherToken}` } },
      env,
    );
    expect(get.status).toBe(404);

    const upstreamCallsBeforeMutation = worldsApiMock.mock.calls.length;
    const update = await api(
      `/v1/worlds/${lastCreatedWorldId}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${otherToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          updateMask: "displayName",
          world: { displayName: "Unauthorized update" },
        }),
      },
      env,
    );
    expect(update.status).toBe(404);

    const remove = await api(
      `/v1/worlds/${lastCreatedWorldId}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${otherToken}` },
      },
      env,
    );
    expect(remove.status).toBe(404);
    expect(worldsApiMock.mock.calls).toHaveLength(upstreamCallsBeforeMutation);
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
        new Response(JSON.stringify({ uid: "key-1", token: "wzw_test-key" }), {
          status: 201,
        }),
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
