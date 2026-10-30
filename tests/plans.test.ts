import { describe, expect, it } from "vitest";
import type { Bindings } from "../src/env";
import { planDailyRowWrites } from "../src/lib/plans";
import { state, authHeaders, usePlansHarness } from "./helpers/plans-harness";

describe("plans and the per-namespace write budget", () => {
  const h = usePlansHarness();
  const { api, asAdmin, rows } = h;

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
      headers: authHeaders(h.userToken),
      body: JSON.stringify({ world: { displayName: "First" } }),
    });
    expect(res.status).toBe(201);
    const put = state.calls.find((c) => c.method === "PUT");
    expect(put?.path).toBe(`/admin/namespaces/${h.userUid}/write-budget`);
    expect(put?.body).toEqual({ dailyRows: 50_000 });
  });

  it("still creates the world when the budget cannot be applied", async () => {
    state.budgetPutStatus = 500;
    const res = await api("/v1/worlds", {
      method: "POST",
      headers: authHeaders(h.userToken),
      body: JSON.stringify({ world: { displayName: "Despite sync failure" } }),
    });
    expect(res.status).toBe(201);
  });

  describe("PUT /v1/admin/users/{userUid}/plan", () => {
    it("saves the plan, applies its budget and writes an audit event", async () => {
      const res = await asAdmin(`/v1/admin/users/${h.userUid}/plan`, {
        plan: "pro",
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        userUid: h.userUid,
        plan: "pro",
        dailyRowWrites: 1_000_000,
      });
      expect(
        rows<{ plan: string }>(
          "SELECT plan FROM users WHERE uid = ?",
          h.userUid,
        )[0]!.plan,
      ).toBe("pro");
      expect(state.calls.find((c) => c.method === "PUT")?.body).toEqual({
        dailyRows: 1_000_000,
      });
      const audit = rows<{ action: string; outcome: string }>(
        "SELECT action, outcome FROM admin_audit_events WHERE action = 'users.setPlan' ORDER BY create_time DESC",
      );
      expect(audit[0]).toMatchObject({ outcome: "SUCCESS" });
    });

    it("applies the new plan's budget to later worlds", async () => {
      await asAdmin(`/v1/admin/users/${h.userUid}/plan`, { plan: "pro" });
      state.calls = [];
      await api("/v1/worlds", {
        method: "POST",
        headers: authHeaders(h.userToken),
        body: JSON.stringify({ world: { displayName: "Pro world" } }),
      });
      expect(state.calls.find((c) => c.method === "PUT")?.body).toEqual({
        dailyRows: 1_000_000,
      });
    });

    it("keeps the plan but returns 502 when the data plane refuses the budget", async () => {
      state.budgetPutStatus = 500;
      const res = await asAdmin(`/v1/admin/users/${h.userUid}/plan`, {
        plan: "free",
      });
      expect(res.status).toBe(502);
      expect(
        ((await res.json()) as { error: { code: string } }).error.code,
      ).toBe("BUDGET_SYNC_FAILED");
      expect(
        rows<{ plan: string }>(
          "SELECT plan FROM users WHERE uid = ?",
          h.userUid,
        )[0]!.plan,
      ).toBe("free");
      expect(
        rows<{ outcome: string }>(
          "SELECT outcome FROM admin_audit_events WHERE action = 'users.setPlan' ORDER BY create_time DESC",
        )[0]!.outcome,
      ).toBe("FAILED");
      // Repeating the call once the data plane is back finishes the job.
      state.budgetPutStatus = 200;
      const retry = await asAdmin(`/v1/admin/users/${h.userUid}/plan`, {
        plan: "free",
      });
      expect(retry.status).toBe(200);
    });

    it("rejects an unknown plan and an unknown user", async () => {
      expect(
        (await asAdmin(`/v1/admin/users/${h.userUid}/plan`, { plan: "gold" }))
          .status,
      ).toBe(400);
      expect(
        (await asAdmin(`/v1/admin/users/${h.userUid}/plan`, {})).status,
      ).toBe(400);
      expect(
        (await asAdmin("/v1/admin/users/nobody/plan", { plan: "pro" })).status,
      ).toBe(404);
    });

    it("is admin-only", async () => {
      const res = await api(`/v1/admin/users/${h.userUid}/plan`, {
        method: "PUT",
        headers: authHeaders(h.userToken),
        body: JSON.stringify({ plan: "pro" }),
      });
      expect([401, 403]).toContain(res.status);
      const anon = await api(`/v1/admin/users/${h.userUid}/plan`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: "pro" }),
      });
      expect(anon.status).toBe(401);
    });
  });
});
