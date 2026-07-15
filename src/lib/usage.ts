import type { Bindings } from "../env";
import { db, id } from "./db";

export async function recordUsage(env: Bindings, input: {
  organizationId: string;
  worldId?: string | null;
  metric: string;
  quantity?: number;
  unit?: string;
  billingSource?: string;
}) {
  await db(env).prepare(
    "INSERT INTO usage_events (id, organization_id, world_id, metric, quantity, unit, billing_source, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(id(), input.organizationId, input.worldId ?? null, input.metric, input.quantity ?? 1, input.unit ?? "count", input.billingSource ?? "BETA_FREE", new Date().toISOString())
    .run();
}
