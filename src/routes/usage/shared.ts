import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../../env";
import { db, first } from "../../lib/db";

export async function resolveWorld(
  c: Context<AppEnv>,
  userUid: string,
  worldId: string,
): Promise<{ world_id: string }> {
  const world = await first<{ world_id: string }>(
    db(c.env)
      .prepare(
        "SELECT world_id FROM worlds WHERE user_uid = ? AND world_id = ?",
      )
      .bind(userUid, worldId),
  );
  if (!world) throw new HTTPException(404, { message: "World not found" });
  return world;
}

export type UsageEventRow = {
  uid: string;
  metric: string;
  quantity: number;
  unit: string;
  providerCostMicrocents?: number | null;
  wazooMarkupMicrocents?: number;
  estimatedCostMicrocents?: number | null;
  billingSource: string;
  createTime: string;
};

export function usageEventResource(row: UsageEventRow) {
  return {
    name: `usageEvents/${row.uid}`,
    metric: row.metric,
    quantity: row.quantity,
    unit: row.unit,
    providerCostMicrocents: row.providerCostMicrocents,
    wazooMarkupMicrocents: row.wazooMarkupMicrocents,
    estimatedCostMicrocents: row.estimatedCostMicrocents,
    billingSource: row.billingSource,
    createTime: row.createTime,
  };
}

export function usageRange(query: { from?: string; to?: string }) {
  const args: string[] = [];
  let where = "";
  if (query.from) {
    where += " AND create_time >= ?";
    args.push(query.from);
  }
  if (query.to) {
    where += " AND create_time <= ?";
    args.push(query.to);
  }
  return { where, args };
}
