import type { Context } from "hono";
import type { AppEnv } from "../env";
import { db, first } from "./db";

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

export async function activeWorldCount(c: Context<AppEnv>, organizationUid: string): Promise<number> {
  const row = await first<{ count: number }>(
    db(c.env).prepare("SELECT COUNT(*) AS count FROM worlds WHERE organization_uid = ? AND state != 'deleted'").bind(organizationUid)
  );
  return row?.count ?? 0;
}

export async function quotaStatus(c: Context<AppEnv>, organizationUid: string, organizationState: string): Promise<QuotaStatus> {
  if (organizationState === "SUSPENDED") return { state: "SUSPENDED", reason: "ORGANIZATION_SUSPENDED" };
  if (organizationState === "DELETED") return { state: "SUSPENDED", reason: "ORGANIZATION_DELETED" };

  const count = await activeWorldCount(c, organizationUid);
  if (count >= privateBetaQuota.maxWorlds) {
    return { state: "THROTTLED", reason: "MAX_WORLDS_EXCEEDED", usagePercent: 100 };
  }
  if (count >= Math.floor(privateBetaQuota.maxWorlds * 0.8)) {
    return { state: "WARN", reason: "MAX_WORLDS_80_PERCENT", usagePercent: Math.floor((count / privateBetaQuota.maxWorlds) * 100) };
  }
  return { state: "OK", usagePercent: Math.floor((count / privateBetaQuota.maxWorlds) * 100) };
}

export function quotaError(c: Context<AppEnv>, message: string, quota: QuotaStatus) {
  return c.json({ error: { code: "RESOURCE_EXHAUSTED", message }, quota }, 429);
}
