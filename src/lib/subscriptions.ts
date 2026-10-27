import type { Bindings } from "../env";
import { db, first } from "./db";
import { setUserPlan, type PlanName } from "./plans";

/**
 * Applies Stripe subscription events to a user's plan. A subscription maps to
 * the `pro` plan; ending it puts the user back on `free`. The user's plan then
 * sets their daily write budget in worlds-api (see lib/plans.ts).
 */

export type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, any> };
};

/** Subscription statuses that keep a user on pro. `past_due` stays pro while Stripe retries the payment. */
const PRO_STATUSES = new Set(["active", "trialing", "past_due"]);

/** The only event types that change anything; others are acknowledged without work. */
export const HANDLED_EVENT_TYPES: ReadonlySet<string> = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

type UserBilling = {
  uid: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

async function userByUid(env: Bindings, uid: string) {
  return first<UserBilling>(
    db(env)
      .prepare(
        "SELECT uid, stripe_customer_id, stripe_subscription_id FROM users WHERE uid = ?",
      )
      .bind(uid),
  );
}

async function userByCustomer(env: Bindings, customerId: string) {
  return first<UserBilling>(
    db(env)
      .prepare(
        "SELECT uid, stripe_customer_id, stripe_subscription_id FROM users WHERE stripe_customer_id = ?",
      )
      .bind(customerId),
  );
}

async function saveBilling(
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

export type ApplyResult =
  | { handled: true; userUid: string; plan: PlanName }
  | { handled: false; reason: string };

/**
 * Applies one verified event. Throws when the plan was saved but worlds-api
 * refused the budget, so the webhook answers 5xx and Stripe retries (the whole
 * step is idempotent). Events that do not concern a known user are not errors.
 */
export async function applyStripeEvent(
  env: Bindings,
  event: StripeEvent,
): Promise<ApplyResult> {
  const object = event.data?.object ?? {};

  if (event.type === "checkout.session.completed") {
    if (object.mode !== "subscription") {
      return { handled: false, reason: "not a subscription checkout" };
    }
    const uid =
      typeof object.client_reference_id === "string"
        ? object.client_reference_id
        : (object.metadata?.user_uid as string | undefined);
    const user = uid ? await userByUid(env, uid) : null;
    if (!user) return { handled: false, reason: "no matching user" };
    await saveBilling(
      env,
      user.uid,
      typeof object.customer === "string" ? object.customer : null,
      typeof object.subscription === "string" ? object.subscription : null,
    );
    await upgradeOrThrow(env, user.uid, "pro");
    return { handled: true, userUid: user.uid, plan: "pro" };
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const subscriptionId = typeof object.id === "string" ? object.id : null;
    const customerId =
      typeof object.customer === "string" ? object.customer : null;
    const metaUid = object.metadata?.user_uid as string | undefined;
    const user =
      (customerId ? await userByCustomer(env, customerId) : null) ??
      (metaUid ? await userByUid(env, metaUid) : null);
    if (!user) return { handled: false, reason: "no matching user" };

    const isPro =
      event.type !== "customer.subscription.deleted" &&
      PRO_STATUSES.has(String(object.status));

    if (isPro) {
      await saveBilling(env, user.uid, customerId, subscriptionId);
      await upgradeOrThrow(env, user.uid, "pro");
      return { handled: true, userUid: user.uid, plan: "pro" };
    }

    // The subscription ended. Ignore a late event for an old subscription when
    // the user has since moved to a different one.
    if (
      user.stripe_subscription_id &&
      subscriptionId &&
      user.stripe_subscription_id !== subscriptionId
    ) {
      return { handled: false, reason: "stale subscription event" };
    }
    await saveBilling(env, user.uid, customerId, null);
    await upgradeOrThrow(env, user.uid, "free");
    return { handled: true, userUid: user.uid, plan: "free" };
  }

  return { handled: false, reason: "event type ignored" };
}

async function upgradeOrThrow(env: Bindings, uid: string, plan: PlanName) {
  const sync = await setUserPlan(env, uid, plan);
  if (!sync.ok) {
    throw new Error(
      `plan ${plan} saved for ${uid} but the data plane refused its budget: ${sync.detail}`,
    );
  }
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
  event: StripeEvent,
): Promise<void> {
  await db(env)
    .prepare(
      "INSERT OR IGNORE INTO stripe_events (event_id, event_type) VALUES (?, ?)",
    )
    .bind(event.id, event.type)
    .run();
}
