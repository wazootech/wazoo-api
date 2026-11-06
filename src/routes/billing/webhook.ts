import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { verifyStripeSignature } from "../../lib/stripe";
import {
  applyStripeEvent,
  HANDLED_EVENT_TYPES,
  eventAlreadyProcessed,
  markEventProcessed,
  type StripeEvent,
} from "../../lib/subscriptions";

export const stripeWebhook = new Hono<AppEnv>().post(
  "/v1/stripe/webhook",
  async (c) => {
    // Fail closed. An unset signing secret means we cannot authenticate the
    // caller, and an unauthenticated webhook is an unauthenticated write.
    // Returning 503 tells Stripe to retry rather than silently dropping
    // events, so provisioning the secret is a deploy, not a backfill.
    const secret = c.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      console.error(
        "[stripe-webhook] STRIPE_WEBHOOK_SECRET is not configured; rejecting",
      );
      return c.json(
        {
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "Stripe webhook is not configured",
          },
        },
        503,
      );
    }

    const body = await c.req.text();
    const signature = c.req.header("stripe-signature");
    if (!signature || !(await verifyStripeSignature(body, signature, secret))) {
      return c.json(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "Invalid Stripe webhook signature",
          },
        },
        401,
      );
    }

    let event: StripeEvent;
    try {
      event = JSON.parse(body) as StripeEvent;
    } catch {
      return c.json(
        { error: { code: "INVALID_ARGUMENT", message: "Body is not JSON" } },
        400,
      );
    }
    if (typeof event.id !== "string" || typeof event.type !== "string") {
      return c.json(
        { error: { code: "INVALID_ARGUMENT", message: "Not a Stripe event" } },
        400,
      );
    }

    // Acknowledge event types we do not act on without touching the database.
    if (!HANDLED_EVENT_TYPES.has(event.type)) {
      return c.json({ received: true, handled: false });
    }

    // Stripe delivers at least once. Skip events already applied; an event is
    // recorded only after it succeeds, so a failure is retried by Stripe.
    if (await eventAlreadyProcessed(c.env, event.id)) {
      return c.json({ received: true, duplicate: true });
    }
    try {
      const result = await applyStripeEvent(c.env, event);
      await markEventProcessed(c.env, event);
      return c.json({ received: true, handled: result.handled });
    } catch (error) {
      console.error("[stripe-webhook] applying the event failed", {
        eventId: event.id,
        type: event.type,
        error: error instanceof Error ? error.message : String(error),
      });
      return c.json(
        {
          error: {
            code: "INTERNAL",
            message: "Could not apply the event; Stripe will retry",
          },
        },
        500,
      );
    }
  },
);
