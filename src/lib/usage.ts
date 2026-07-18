import type { Bindings } from "../env";
import { db, id } from "./db";

export async function recordUsage(
  env: Bindings,
  input: {
    organizationUid: string;
    worldUid?: string | null;
    metric: string;
    quantity?: number;
    unit?: string;
    billingSource?: string;
  },
) {
  await db(env)
    .prepare(
      "INSERT INTO usage_events (uid, organization_uid, world_uid, metric, quantity, unit, billing_source) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      id(),
      input.organizationUid,
      input.worldUid ?? null,
      input.metric,
      input.quantity ?? 1,
      input.unit ?? "count",
      input.billingSource ?? "BETA_FREE",
    )
    .run();
}
