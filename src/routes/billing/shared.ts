import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../../env";
import { db, first } from "../../lib/db";

export async function resolveWorldBilling(
  c: Context<AppEnv>,
  userUid: string,
  worldId: string,
): Promise<{
  world_id: string;
  billing_provider: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  billing_state: string;
}> {
  const row = await first<{
    world_id: string;
    billing_provider: string;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    billing_state: string;
  }>(
    db(c.env)
      .prepare(
        "SELECT world_id, billing_provider, stripe_customer_id, stripe_subscription_id, billing_state FROM worlds WHERE user_uid = ? AND world_id = ?",
      )
      .bind(userUid, worldId),
  );
  if (!row) throw new HTTPException(404, { message: "World not found" });
  return row;
}
