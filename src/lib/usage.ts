import type { Bindings } from "../env";
import { db, id } from "./db";

export async function recordUsage(
  env: Bindings,
  input: {
    userUid: string;
    worldId?: string | null;
    metric: string;
    quantity?: number;
    unit?: string;
    billingSource?: string;
  },
) {
  await db(env)
    .prepare(
      "INSERT INTO usage_events (uid, user_uid, world_id, metric, quantity, unit, billing_source) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      id(),
      input.userUid,
      input.worldId ?? null,
      input.metric,
      input.quantity ?? 1,
      input.unit ?? "count",
      input.billingSource ?? "BETA_FREE",
    )
    .run();
}
