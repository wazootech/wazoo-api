import {
  getNamespaceWriteBudget,
  setNamespaceWriteBudget,
} from "@worlds/client";
import type { Bindings } from "../env";
import { db, first } from "./db";
import { worldsAdminClient, worldsApiErrorDetail } from "./worlds-client";

/**
 * Plans map a user to a daily D1 row-write budget in worlds-api. The user's id
 * is their worlds-api namespace, so the budget is per user, shared by all of
 * their worlds. Stripe (a later change) only has to call `setUserPlan`.
 */
export const PLAN_NAMES = ["free", "pro"] as const;
export type PlanName = (typeof PLAN_NAMES)[number];
export const DEFAULT_PLAN: PlanName = "free";

/**
 * Daily rows written per plan. A stored quad costs about 9 rows, and about 94
 * per asserted quad with inference on, so free is roughly 5,500 stored quads a
 * day. These are placeholders pending the owner's numbers; override per
 * deployment with PLAN_FREE_DAILY_ROW_WRITES and PLAN_PRO_DAILY_ROW_WRITES.
 */
const DEFAULT_DAILY_ROW_WRITES: Record<PlanName, number> = {
  free: 50_000,
  pro: 1_000_000,
};

const ENV_OVERRIDE: Record<PlanName, keyof Bindings> = {
  free: "PLAN_FREE_DAILY_ROW_WRITES",
  pro: "PLAN_PRO_DAILY_ROW_WRITES",
};

export function isPlanName(value: unknown): value is PlanName {
  return PLAN_NAMES.includes(value as PlanName);
}

/** Daily row-write budget for a plan: a valid env override, else the default. */
export function planDailyRowWrites(env: Bindings, plan: PlanName): number {
  const override = Number(env[ENV_OVERRIDE[plan]]);
  return Number.isInteger(override) && override > 0
    ? override
    : DEFAULT_DAILY_ROW_WRITES[plan];
}

/**
 * The user's plan. Unknown values, a missing user, and a database without the
 * `plan` column (migration not applied yet) all read as the free plan.
 */
export async function userPlan(
  env: Bindings,
  userUid: string,
): Promise<PlanName> {
  try {
    const row = await first<{ plan: string }>(
      db(env).prepare("SELECT plan FROM users WHERE uid = ?").bind(userUid),
    );
    return isPlanName(row?.plan) ? row.plan : DEFAULT_PLAN;
  } catch (error) {
    console.warn("plan lookup failed; treating the user as free", { error });
    return DEFAULT_PLAN;
  }
}

export type BudgetSync =
  | { ok: true; dailyRowWrites: number }
  | { ok: false; dailyRowWrites: number; detail: string };

/**
 * Pushes the plan's budget to worlds-api (idempotent). Never throws, so a
 * worlds-api problem cannot fail the request that triggered it: callers decide
 * whether a failed sync matters.
 */
export async function syncPlanBudget(
  env: Bindings,
  userUid: string,
  plan: PlanName,
): Promise<BudgetSync> {
  const dailyRowWrites = planDailyRowWrites(env, plan);
  try {
    const res = await setNamespaceWriteBudget({
      client: worldsAdminClient(env),
      path: { namespace: userUid },
      body: { dailyRows: dailyRowWrites },
    });
    if (res.error) {
      return {
        ok: false,
        dailyRowWrites,
        detail: worldsApiErrorDetail(res).message,
      };
    }
    return { ok: true, dailyRowWrites };
  } catch (error) {
    return {
      ok: false,
      dailyRowWrites,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Stores the plan and pushes its budget to worlds-api. */
export async function setUserPlan(
  env: Bindings,
  userUid: string,
  plan: PlanName,
): Promise<BudgetSync> {
  await db(env)
    .prepare("UPDATE users SET plan = ? WHERE uid = ?")
    .bind(plan, userUid)
    .run();
  return syncPlanBudget(env, userUid, plan);
}

export type PlanUsage = {
  dailyRowWrites: number | null;
  rowsWrittenToday: number;
  day: string;
};

/** Today's usage against the budget, read from worlds-api; null if it fails. */
export async function readPlanUsage(
  env: Bindings,
  userUid: string,
): Promise<PlanUsage | null> {
  try {
    const res = await getNamespaceWriteBudget({
      client: worldsAdminClient(env),
      path: { namespace: userUid },
    });
    if (res.error || !res.data) return null;
    return {
      dailyRowWrites: res.data.effectiveDailyRows,
      rowsWrittenToday: res.data.rowsWrittenToday,
      day: res.data.day,
    };
  } catch (error) {
    console.warn("plan usage read failed", { error });
    return null;
  }
}
