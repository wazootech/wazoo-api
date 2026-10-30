import { describe, expect, it } from "vitest";
import { createTestD1 } from "./helpers/d1-test-adapter";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  state,
  DEPLOYMENT_DEFAULT,
  authHeaders,
  usePlansHarness,
} from "./helpers/plans-harness";

describe("plans and the per-namespace write budget", () => {
  const h = usePlansHarness();
  const { api, asAdmin, budgetPuts } = h;

  describe("GET /v1/users/me/plan", () => {
    it("returns the plan with today's usage against its budget", async () => {
      await asAdmin(`/v1/admin/users/${h.userUid}/plan`, { plan: "free" });
      const res = await api("/v1/users/me/plan", {
        headers: authHeaders(h.userToken),
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
      state.storedOverride = null;
      const res = await api("/v1/users/me/plan", {
        headers: authHeaders(h.userToken),
      });
      expect(await res.json()).toMatchObject({
        plan: "free",
        dailyRowWrites: 50_000,
        rowsWrittenToday: 12_500,
        usagePercent: 25,
      });
      expect(state.storedOverride).toBe(50_000);
      expect(budgetPuts()).toHaveLength(1);
    });

    it("corrects a stale budget, for example after a plan number changed", async () => {
      state.storedOverride = 25_000;
      const res = await api("/v1/users/me/plan", {
        headers: authHeaders(h.userToken),
      });
      expect(
        ((await res.json()) as { dailyRowWrites: number }).dailyRowWrites,
      ).toBe(50_000);
      expect(state.storedOverride).toBe(50_000);
    });

    it("does not write when the budget already matches the plan", async () => {
      await api("/v1/users/me/plan", { headers: authHeaders(h.userToken) });
      await api("/v1/users/me/plan", { headers: authHeaders(h.userToken) });
      expect(budgetPuts()).toHaveLength(0);
    });

    it("still reports usage when the reconcile cannot be applied", async () => {
      state.storedOverride = null;
      state.budgetPutStatus = 500;
      const res = await api("/v1/users/me/plan", {
        headers: authHeaders(h.userToken),
      });
      expect(res.status).toBe(200);
      // Honest about what applies right now: the deployment default.
      expect(await res.json()).toMatchObject({
        dailyRowWrites: DEPLOYMENT_DEFAULT,
        rowsWrittenToday: 12_500,
      });
    });

    it("still answers, with null usage, when the data plane is unreachable", async () => {
      state.usageStatus = 500;
      const res = await api("/v1/users/me/plan", {
        headers: authHeaders(h.userToken),
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
      const oldEnv = { ...h.env, DB: createTestD1(oldPath) };
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
