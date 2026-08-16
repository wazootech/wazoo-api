import type { Context } from "hono";
import type { AppEnv } from "../env";
import { all, db, first } from "./db";
import { respond } from "./http";

export const privateBetaQuota = {
  name: "PRIVATE_BETA_DEFAULT",
  maxWorlds: 10,
  maxPendingApplications: 200,
};

export type QuotaStatus = {
  state: "OK" | "WARN" | "THROTTLED" | "SUSPENDED";
  reason?: string;
  usagePercent?: number;
};

export async function activeWorldCount(
  c: Context<AppEnv>,
  userUid: string,
): Promise<number> {
  const row = await first<{ count: number }>(
    db(c.env)
      .prepare(
        "SELECT COUNT(*) AS count FROM worlds WHERE user_uid = ? AND state != 'deleted'",
      )
      .bind(userUid),
  );
  return row?.count ?? 0;
}

export async function quotaStatus(
  c: Context<AppEnv>,
  userUid: string,
): Promise<QuotaStatus> {
  const count = await activeWorldCount(c, userUid);
  if (count >= privateBetaQuota.maxWorlds) {
    return {
      state: "THROTTLED",
      reason: "MAX_WORLDS_EXCEEDED",
      usagePercent: 100,
    };
  }
  if (count >= Math.floor(privateBetaQuota.maxWorlds * 0.8)) {
    return {
      state: "WARN",
      reason: "MAX_WORLDS_80_PERCENT",
      usagePercent: Math.floor((count / privateBetaQuota.maxWorlds) * 100),
    };
  }
  return {
    state: "OK",
    usagePercent: Math.floor((count / privateBetaQuota.maxWorlds) * 100),
  };
}

export function quotaError(
  c: Context<AppEnv>,
  message: string,
  quota: QuotaStatus,
) {
  return respond(
    c,
    { error: { code: "RESOURCE_EXHAUSTED", message }, quota },
    429,
  );
}

export type LimitSummary = {
  metric: string;
  quantity: number;
  limitQuantity: number;
  usagePercent: number;
};

export type QuotaSummary = {
  state: "OK" | "WARN" | "THROTTLED";
  usagePercent: number;
  limits: LimitSummary[];
};

function usagePercentOf(quantity: number, limitQuantity: number): number {
  if (!limitQuantity || limitQuantity <= 0) return 0;
  return Math.floor((quantity / limitQuantity) * 100);
}

export function summarizeLimits(limits: LimitSummary[]): QuotaSummary {
  const usagePercent = limits.length
    ? Math.max(...limits.map((limit) => limit.usagePercent))
    : 0;
  const state: QuotaSummary["state"] =
    usagePercent >= 100 ? "THROTTLED" : usagePercent >= 80 ? "WARN" : "OK";
  return { state, usagePercent, limits };
}

/**
 * Per-metric quota summary for a single world (used by the usage endpoint).
 * `totals` is the summed usage per metric for the requested window.
 */
export async function worldUsageQuota(
  c: Context<AppEnv>,
  worldUid: string,
  totals: Array<{ metric: string; quantity: number }>,
): Promise<QuotaSummary> {
  const limitRows = await all<{ metric: string; limit_quantity: number }>(
    db(c.env)
      .prepare(
        "SELECT metric, limit_quantity FROM world_limits WHERE world_uid = ? ORDER BY metric",
      )
      .bind(worldUid),
  );
  const totalByMetric = new Map(
    totals.map((total) => [total.metric, total.quantity]),
  );
  return summarizeLimits(
    limitRows.map((limit) => ({
      metric: limit.metric,
      quantity: totalByMetric.get(limit.metric) ?? 0,
      limitQuantity: limit.limit_quantity,
      usagePercent: usagePercentOf(
        totalByMetric.get(limit.metric) ?? 0,
        limit.limit_quantity,
      ),
    })),
  );
}

/**
 * Plan-cap quota summary for billing: the user's active world count against
 * the private-beta cap plus per-world metric limits.
 */
export async function worldBillingQuota(
  c: Context<AppEnv>,
  userUid: string,
  worldUid: string,
  totals: Array<{ metric: string; quantity: number }>,
): Promise<QuotaSummary> {
  const active = await activeWorldCount(c, userUid);
  const perWorld = await worldUsageQuota(c, worldUid, totals);
  return summarizeLimits([
    {
      metric: "MAX_WORLDS",
      quantity: active,
      limitQuantity: privateBetaQuota.maxWorlds,
      usagePercent: usagePercentOf(active, privateBetaQuota.maxWorlds),
    },
    ...perWorld.limits,
  ]);
}
