import { afterAll, beforeAll, beforeEach, expect, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app from "../../src/index";
import type { Bindings } from "../../src/env";
import { createTestD1, type TestD1 } from "./d1-test-adapter";

export const ADMIN_TOKEN = "wzp_test-admin-token";
export const TEST_EMAIL = "worlds-user@example.com";
const WORLDS_BASE = "http://localhost:9999";
export const CREATED_WORLD_ID = "w_00000000000000000000000001";

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

export function api(
  path: string,
  init: RequestInit,
  env: Bindings,
): Promise<Response> {
  return Promise.resolve(app.request(path, init, env, executionCtx));
}

/** Normalizes either `fetch(request)` (Request object) or `fetch(url, init)`. */
export function requestFromCall(
  input: RequestInfo | URL,
  init?: RequestInit,
): Request {
  return input instanceof Request ? input : new Request(String(input), init);
}

/** worlds-api's reply to PUT /admin/namespaces/{ns}/write-budget. */
export function budgetAppliedResponse() {
  return new Response(
    JSON.stringify({
      namespace: "ns",
      dailyRows: 50000,
      defaultDailyRows: null,
      effectiveDailyRows: 50000,
      rowsWrittenToday: 0,
      day: "2026-10-27",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

export const state = {
  createdCounter: 0,
  lastCreatedWorldId: CREATED_WORLD_ID,
};

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
  if (url.includes("/write-budget") && method === "PUT") {
    return budgetAppliedResponse();
  }
  if (url.endsWith("/worlds") && method === "POST") {
    // Canonical ids are minted by the data plane and unique per world.
    state.lastCreatedWorldId = `w_00000000000000${String(++state.createdCounter).padStart(12, "0")}`;
    return new Response(
      JSON.stringify({
        id: state.lastCreatedWorldId,
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
  if (
    url.endsWith(`/worlds/${state.lastCreatedWorldId}`) &&
    method === "DELETE"
  ) {
    return new Response(null, { status: 204 });
  }
  if (
    url.endsWith(`/worlds/${state.lastCreatedWorldId}/undelete`) &&
    method === "POST"
  ) {
    return new Response(
      JSON.stringify({
        name: `worlds/${state.lastCreatedWorldId}`,
        uid: state.lastCreatedWorldId,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  return new Response(
    JSON.stringify({ error: { code: "UNEXPECTED", message: url } }),
    { status: 500, headers: { "content-type": "application/json" } },
  );
}

/** Registers the shared suite setup (database, session, fake worlds-api) in the calling describe. */
export function useWorldsHarness() {
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
    const client = new DatabaseSync((env.DB as TestD1).path);
    const rs = client.prepare("PRAGMA table_info(worlds)").all();
    client.close();
    const worldIdCol = rs.find((row) => row.name === "world_id");
    expect(worldIdCol).toBeTruthy();
    expect(worldIdCol!.pk).toBe(1);
    expect(worldIdCol!.notnull).toBe(1);
  });

  return {
    get env() {
      return env;
    },
    get sessionToken() {
      return sessionToken;
    },
    get worldsApiMock() {
      return worldsApiMock;
    },
  };
}
