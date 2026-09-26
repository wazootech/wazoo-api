import type { Bindings } from "../env";
import { db, id } from "./db";

export async function recordUsage(
  env: Bindings,
  input: {
    userId: string;
    worldId?: string | null;
    metric: string;
    quantity?: number;
    unit?: string;
    billingSource?: string;
  },
) {
  await db(env)
    .prepare(
      "INSERT INTO usage_events (event_id, user_id, world_id, metric, quantity, unit, billing_source) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      id(),
      input.userId,
      input.worldId ?? null,
      input.metric,
      input.quantity ?? 1,
      input.unit ?? "count",
      input.billingSource ?? "BETA_FREE",
    )
    .run();
}
