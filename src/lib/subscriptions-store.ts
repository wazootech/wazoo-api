import type { Bindings } from "../env";
import { db, first } from "./db";

export type StripeEventRef = { id: string; type: string };

export type UserBilling = {
  uid: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

export async function userByUid(env: Bindings, uid: string) {
  return first<UserBilling>(
    db(env)
      .prepare(
        "SELECT uid, stripe_customer_id, stripe_subscription_id FROM users WHERE uid = ?",
      )
      .bind(uid),
  );
}

export async function userByCustomer(env: Bindings, customerId: string) {
  return first<UserBilling>(
    db(env)
      .prepare(
        "SELECT uid, stripe_customer_id, stripe_subscription_id FROM users WHERE stripe_customer_id = ?",
      )
      .bind(customerId),
  );
}

export async function saveBilling(
  env: Bindings,
  uid: string,
  customerId: string | null,
  subscriptionId: string | null,
) {
  await db(env)
    .prepare(
      "UPDATE users SET stripe_customer_id = COALESCE(?, stripe_customer_id), stripe_subscription_id = ? WHERE uid = ?",
    )
    .bind(customerId, subscriptionId, uid)
    .run();
}

/** True when this event id was already applied. */
export async function eventAlreadyProcessed(
  env: Bindings,
  eventId: string,
): Promise<boolean> {
  const row = await first<{ event_id: string }>(
    db(env)
      .prepare("SELECT event_id FROM stripe_events WHERE event_id = ?")
      .bind(eventId),
  );
  return Boolean(row);
}

export async function markEventProcessed(
  env: Bindings,
  event: StripeEventRef,
): Promise<void> {
  await db(env)
    .prepare(
      "INSERT OR IGNORE INTO stripe_events (event_id, event_type) VALUES (?, ?)",
    )
    .bind(event.id, event.type)
    .run();
}
