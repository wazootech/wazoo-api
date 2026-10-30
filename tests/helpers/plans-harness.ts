import { afterAll, beforeAll, beforeEach, expect, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app from "../../src/index";
import type { Bindings } from "../../src/env";
import { createTestD1, type TestD1 } from "./d1-test-adapter";

const WORLDS_BASE = "http://localhost:9999";
export const ADMIN_TOKEN = "wzp_test-admin-token";

export type TestBindings = Bindings & { DB: TestD1 };

const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export const authHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

/** worlds-api behaviour the platform depends on, recorded for assertions. */
type WorldsCall = { method: string; path: string; body?: unknown };
export const DEPLOYMENT_DEFAULT = 500_000;
export const state = {
  calls: [] as WorldsCall[],
  budgetPutStatus: 200,
  /** The override worlds-api holds for the test user, or null when none is set. */
  storedOverride: 50_000 as number | null,
  usage: { rowsWrittenToday: 12_500 },
  usageStatus: 200,
  worldCounter: 0,
};

async function worldsApi(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const req =
    input instanceof Request ? input : new Request(String(input), init);
  const path = req.url.slice(WORLDS_BASE.length);
  const method = req.method;
  const text = method === "GET" || method === "DELETE" ? "" : await req.text();
  state.calls.push({ method, path, body: text ? JSON.parse(text) : undefined });

  const budgetMatch = path.match(
    /^\/admin\/namespaces\/([^/]+)\/write-budget$/,
  );
  if (budgetMatch && method === "PUT") {
    if (state.budgetPutStatus !== 200) {
      return json(
        { error: { code: "INTERNAL", message: "data plane down" } },
        state.budgetPutStatus,
      );
    }
    const dailyRows = (JSON.parse(text) as { dailyRows: number }).dailyRows;
    state.storedOverride = dailyRows;
    return json({
      namespace: budgetMatch[1],
      dailyRows,
      defaultDailyRows: null,
      effectiveDailyRows: dailyRows,
      rowsWrittenToday: 0,
      day: "2026-10-27",
    });
  }
  if (budgetMatch && method === "GET") {
    if (state.usageStatus !== 200) {
      return json(
        { error: { code: "INTERNAL", message: "down" } },
        state.usageStatus,
      );
    }
    return json({
      namespace: budgetMatch[1],
      dailyRows: state.storedOverride,
      defaultDailyRows: DEPLOYMENT_DEFAULT,
      effectiveDailyRows: state.storedOverride ?? DEPLOYMENT_DEFAULT,
      rowsWrittenToday: state.usage.rowsWrittenToday,
      day: "2026-10-27",
    });
  }
  if (path === "/api-keys" && method === "POST") {
    return json({ uid: "key-1", token: "wzw_test-key" }, 201);
  }
  if (path === "/worlds" && method === "POST") {
    const id = `w_${String(++state.worldCounter).padStart(26, "0")}`;
    return json(
      {
        id,
        displayName: "W",
        state: "active",
        storage: "d1-world",
        embeddingModel: "tfjs-universal-sentence-encoder",
        chunkSize: 1000,
        topK: 20,
        minScore: 0,
        createTime: new Date().toISOString(),
        updateTime: new Date().toISOString(),
      },
      201,
    );
  }
  return json({ error: { code: "UNEXPECTED", message: path } }, 500);
}

/** Registers the shared suite setup (database, user, fake worlds-api) in the calling describe. */
export function usePlansHarness() {
  let dir: string;
  let dbPath: string;
  let env: TestBindings;
  let userToken: string;
  let userUid: string;

  const api = (path: string, init: RequestInit = {}, e: Bindings = env) =>
    Promise.resolve(app.request(path, init, e, executionCtx));

  const asAdmin = (path: string, body?: unknown, method = "PUT") =>
    api(path, {
      method,
      headers: authHeaders(ADMIN_TOKEN),
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const budgetPuts = () => state.calls.filter((c) => c.method === "PUT");

  const rows = <T>(sql: string, ...args: unknown[]) => {
    const client = new DatabaseSync(dbPath);
    try {
      return client.prepare(sql).all(...(args as never[])) as T[];
    } finally {
      client.close();
    }
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "wazoo-api-plans-"));
    dbPath = join(dir, "test.db");
    const client = new DatabaseSync(dbPath);
    client.exec(readFileSync(join(process.cwd(), "schema.sql"), "utf8"));
    client.close();
    env = {
      DB: createTestD1(dbPath),
      WORLDS_API_URL: WORLDS_BASE,
      WORLDS_API_ADMIN_KEY: "test",
      WAZOO_PLATFORM_ADMIN_TOKEN: ADMIN_TOKEN,
      WAZOO_ENV: "test",
    };
    vi.stubGlobal("fetch", vi.fn(worldsApi));

    const session = await api("/v1/auth/workos-session", {
      method: "POST",
      headers: authHeaders(ADMIN_TOKEN),
      body: JSON.stringify({
        email: "plans-user@example.com",
        displayName: "Plans User",
        ageConfirmed: true,
      }),
    });
    expect(session.status).toBe(201);
    userToken = ((await session.json()) as { token: string }).token;
    const me = await api("/v1/users/me", { headers: authHeaders(userToken) });
    userUid = ((await me.json()) as { user: { uid: string } }).user.uid;
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
    state.calls = [];
    state.budgetPutStatus = 200;
    state.usageStatus = 200;
    state.storedOverride = 50_000;
    state.usage = { rowsWrittenToday: 12_500 };
  });

  return {
    api,
    asAdmin,
    budgetPuts,
    rows,
    get env() {
      return env;
    },
    get userToken() {
      return userToken;
    },
    get userUid() {
      return userUid;
    },
  };
}
