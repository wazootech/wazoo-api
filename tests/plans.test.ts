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
import { planDailyRowWrites } from "../src/lib/plans";

import { createTestD1, type TestD1 } from "./helpers/d1-test-adapter";

const ADMIN_TOKEN = "wzp_test-admin-token";
const WORLDS_BASE = "http://localhost:9999";

type TestBindings = Bindings & { DB: TestD1 };

const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const authHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

/** worlds-api behaviour the platform depends on, recorded for assertions. */
type WorldsCall = { method: string; path: string; body?: unknown };
let calls: WorldsCall[] = [];
let budgetPutStatus = 200;
const DEPLOYMENT_DEFAULT = 500_000;
/** The override worlds-api holds for the test user, or null when none is set. */
let storedOverride: number | null = 50_000;
let usage = { rowsWrittenToday: 12_500 };
let usageStatus = 200;
let worldCounter = 0;

async function worldsApi(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const req =
    input instanceof Request ? input : new Request(String(input), init);
  const path = req.url.slice(WORLDS_BASE.length);
  const method = req.method;
  const text = method === "GET" || method === "DELETE" ? "" : await req.text();
  calls.push({ method, path, body: text ? JSON.parse(text) : undefined });

  const budgetMatch = path.match(
    /^\/admin\/namespaces\/([^/]+)\/write-budget$/,
  );
  if (budgetMatch && method === "PUT") {
    if (budgetPutStatus !== 200) {
      return json(
        { error: { code: "INTERNAL", message: "data plane down" } },
        budgetPutStatus,
      );
    }
    const dailyRows = (JSON.parse(text) as { dailyRows: number }).dailyRows;
    storedOverride = dailyRows;
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
    if (usageStatus !== 200) {
      return json(
        { error: { code: "INTERNAL", message: "down" } },
        usageStatus,
      );
    }
    return json({
      namespace: budgetMatch[1],
      dailyRows: storedOverride,
      defaultDailyRows: DEPLOYMENT_DEFAULT,
      effectiveDailyRows: storedOverride ?? DEPLOYMENT_DEFAULT,
      rowsWrittenToday: usage.rowsWrittenToday,
      day: "2026-10-27",
    });
  }
  if (path === "/api-keys" && method === "POST") {
    return json({ uid: "key-1", token: "wzw_test-key" }, 201);
  }
  if (path === "/worlds" && method === "POST") {
    const id = `w_${String(++worldCounter).padStart(26, "0")}`;
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

describe("plans and the per-namespace write budget", () => {
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

  const budgetPuts = () => calls.filter((c) => c.method === "PUT");

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
    calls = [];
    budgetPutStatus = 200;
    usageStatus = 200;
    storedOverride = 50_000;
    usage = { rowsWrittenToday: 12_500 };
  });

  describe("planDailyRowWrites", () => {
    it("uses the defaults, and a valid env override", () => {
      expect(planDailyRowWrites({} as Bindings, "free")).toBe(50_000);
      expect(planDailyRowWrites({} as Bindings, "pro")).toBe(1_000_000);
      expect(
        planDailyRowWrites(
          { PLAN_FREE_DAILY_ROW_WRITES: "7000" } as Bindings,
          "free",
        ),
      ).toBe(7000);
    });

    it("ignores an override that is not a positive integer", () => {
      for (const bad of ["0", "-1", "abc", "2.5", ""]) {
        expect(
          planDailyRowWrites(
            { PLAN_PRO_DAILY_ROW_WRITES: bad } as Bindings,
            "pro",
          ),
        ).toBe(1_000_000);
      }
    });
  });

  it("applies the free budget to the user's namespace when a world is created", async () => {
    const res = await api("/v1/worlds", {
      method: "POST",
      headers: authHeaders(userToken),
      body: JSON.stringify({ world: { displayName: "First" } }),
    });
    expect(res.status).toBe(201);
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.path).toBe(`/admin/namespaces/${userUid}/write-budget`);
    expect(put?.body).toEqual({ dailyRows: 50_000 });
  });

  it("still creates the world when the budget cannot be applied", async () => {
    budgetPutStatus = 500;
    const res = await api("/v1/worlds", {
      method: "POST",
      headers: authHeaders(userToken),
      body: JSON.stringify({ world: { displayName: "Despite sync failure" } }),
    });
    expect(res.status).toBe(201);
  });

  describe("PUT /v1/admin/users/{userUid}/plan", () => {
    it("saves the plan, applies its budget and writes an audit event", async () => {
      const res = await asAdmin(`/v1/admin/users/${userUid}/plan`, {
        plan: "pro",
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        userUid,
        plan: "pro",
        dailyRowWrites: 1_000_000,
      });
      expect(
        rows<{ plan: string }>(
          "SELECT plan FROM users WHERE uid = ?",
          userUid,
        )[0]!.plan,
      ).toBe("pro");
      expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
        dailyRows: 1_000_000,
      });
      const audit = rows<{ action: string; outcome: string }>(
        "SELECT action, outcome FROM admin_audit_events WHERE action = 'users.setPlan' ORDER BY create_time DESC",
      );
      expect(audit[0]).toMatchObject({ outcome: "SUCCESS" });
    });

    it("applies the new plan's budget to later worlds", async () => {
      await asAdmin(`/v1/admin/users/${userUid}/plan`, { plan: "pro" });
      calls = [];
      await api("/v1/worlds", {
        method: "POST",
        headers: authHeaders(userToken),
        body: JSON.stringify({ world: { displayName: "Pro world" } }),
      });
      expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
        dailyRows: 1_000_000,
      });
    });

    it("keeps the plan but returns 502 when the data plane refuses the budget", async () => {
      budgetPutStatus = 500;
      const res = await asAdmin(`/v1/admin/users/${userUid}/plan`, {
        plan: "free",
      });
      expect(res.status).toBe(502);
      expect(
        ((await res.json()) as { error: { code: string } }).error.code,
      ).toBe("BUDGET_SYNC_FAILED");
      expect(
        rows<{ plan: string }>(
          "SELECT plan FROM users WHERE uid = ?",
          userUid,
        )[0]!.plan,
      ).toBe("free");
      expect(
        rows<{ outcome: string }>(
          "SELECT outcome FROM admin_audit_events WHERE action = 'users.setPlan' ORDER BY create_time DESC",
        )[0]!.outcome,
      ).toBe("FAILED");
      // Repeating the call once the data plane is back finishes the job.
      budgetPutStatus = 200;
      const retry = await asAdmin(`/v1/admin/users/${userUid}/plan`, {
        plan: "free",
      });
      expect(retry.status).toBe(200);
    });

    it("rejects an unknown plan and an unknown user", async () => {
      expect(
        (await asAdmin(`/v1/admin/users/${userUid}/plan`, { plan: "gold" }))
          .status,
      ).toBe(400);
      expect(
        (await asAdmin(`/v1/admin/users/${userUid}/plan`, {})).status,
      ).toBe(400);
      expect(
        (await asAdmin("/v1/admin/users/nobody/plan", { plan: "pro" })).status,
      ).toBe(404);
    });

    it("is admin-only", async () => {
      const res = await api(`/v1/admin/users/${userUid}/plan`, {
        method: "PUT",
        headers: authHeaders(userToken),
        body: JSON.stringify({ plan: "pro" }),
      });
      expect([401, 403]).toContain(res.status);
      const anon = await api(`/v1/admin/users/${userUid}/plan`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: "pro" }),
      });
      expect(anon.status).toBe(401);
    });
  });

  describe("GET /v1/users/me/plan", () => {
    it("returns the plan with today's usage against its budget", async () => {
      await asAdmin(`/v1/admin/users/${userUid}/plan`, { plan: "free" });
      const res = await api("/v1/users/me/plan", {
        headers: authHeaders(userToken),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        plan: "free",
        dailyRowWrites: 50_000,
        rowsWrittenToday: 12_500,
        usagePercent: 25,
        day: "2026-10-27",
        billing: { checkoutAvailable: false, portalAvailable: false },
      });
    });

    it("applies the plan's budget when the data plane has none for this user yet", async () => {
      // A user from before plans existed: worlds-api only has its default.
      storedOverride = null;
      const res = await api("/v1/users/me/plan", {
        headers: authHeaders(userToken),
      });
      expect(await res.json()).toMatchObject({
        plan: "free",
        dailyRowWrites: 50_000,
        rowsWrittenToday: 12_500,
        usagePercent: 25,
      });
      expect(storedOverride).toBe(50_000);
      expect(budgetPuts()).toHaveLength(1);
    });

    it("corrects a stale budget, for example after a plan number changed", async () => {
      storedOverride = 25_000;
      const res = await api("/v1/users/me/plan", {
        headers: authHeaders(userToken),
      });
      expect(
        ((await res.json()) as { dailyRowWrites: number }).dailyRowWrites,
      ).toBe(50_000);
      expect(storedOverride).toBe(50_000);
    });

    it("does not write when the budget already matches the plan", async () => {
      await api("/v1/users/me/plan", { headers: authHeaders(userToken) });
      await api("/v1/users/me/plan", { headers: authHeaders(userToken) });
      expect(budgetPuts()).toHaveLength(0);
    });

    it("still reports usage when the reconcile cannot be applied", async () => {
      storedOverride = null;
      budgetPutStatus = 500;
      const res = await api("/v1/users/me/plan", {
        headers: authHeaders(userToken),
      });
      expect(res.status).toBe(200);
      // Honest about what applies right now: the deployment default.
      expect(await res.json()).toMatchObject({
        dailyRowWrites: DEPLOYMENT_DEFAULT,
        rowsWrittenToday: 12_500,
      });
    });

    it("still answers, with null usage, when the data plane is unreachable", async () => {
      usageStatus = 500;
      const res = await api("/v1/users/me/plan", {
        headers: authHeaders(userToken),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        dailyRowWrites: null,
        rowsWrittenToday: null,
        usagePercent: null,
        day: null,
      });
    });

    it("requires a signed-in user", async () => {
      const res = await api("/v1/users/me/plan");
      expect(res.status).toBe(401);
    });
  });

  it("reads a database without the plan column as the free plan", async () => {
    const old = mkdtempSync(join(tmpdir(), "wazoo-api-plans-old-"));
    try {
      const oldPath = join(old, "old.db");
      const client = new DatabaseSync(oldPath);
      client.exec(
        readFileSync(join(process.cwd(), "schema.sql"), "utf8").replace(
          "  plan TEXT NOT NULL DEFAULT 'free',\n",
          "",
        ),
      );
      client.close();
      const { userPlan } = await import("../src/lib/plans");
      const oldEnv = { ...env, DB: createTestD1(oldPath) };
      expect(await userPlan(oldEnv, "anyone")).toBe("free");
    } finally {
      try {
        rmSync(old, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 100,
        });
      } catch {
        // Best-effort cleanup: Windows keeps the database file locked.
      }
    }
  });
});
