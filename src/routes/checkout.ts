import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppEnv } from "../env";
import { db, first } from "../lib/db";
import { requireScope, resolveUser, respond } from "../lib/http";
import { userPlan } from "../lib/plans";
import { stripePost } from "../lib/stripe";

const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const SessionUrlSchema = z
  .object({
    url: z.string().url().openapi({
      description:
        "The Stripe-hosted page to send the user to. It is single-use and expires.",
    }),
  })
  .openapi("BillingSessionUrl");

const notConfigured = (c: Context<AppEnv>) =>
  respond(
    c,
    {
      error: {
        code: "BILLING_NOT_CONFIGURED",
        message: "Paid plans are not available yet.",
      },
    },
    503,
  );

/** The console origin Stripe sends the user back to. Unset means billing is off. */
function consoleUrl(c: Context<AppEnv>): string | null {
  const url = c.env.CONSOLE_URL?.replace(/\/+$/, "");
  return url && /^https?:\/\//.test(url) ? url : null;
}

type UserBillingRow = {
  uid: string;
  email: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

async function billingRow(c: Context<AppEnv>, uid: string) {
  return first<UserBillingRow>(
    db(c.env)
      .prepare(
        "SELECT uid, email, stripe_customer_id, stripe_subscription_id FROM users WHERE uid = ?",
      )
      .bind(uid),
  );
}

const checkoutRoute = createRoute({
  method: "post",
  path: "/v1/users/me/billing/checkout",
  tags: ["Billing"],
  operationId: "createCheckoutSession",
  summary: "Start a Pro subscription checkout",
  description:
    "Creates a Stripe Checkout session for the Pro plan and returns the hosted page's URL. The plan changes when Stripe confirms the payment (a webhook), not when this call returns, so the console shows the new plan shortly after the user comes back.",
  "x-mint": { metadata: { title: "Start a Pro checkout" } },
  security: [{ bearerPlatformToken: [] }],
  responses: {
    200: {
      description: "Checkout session created",
      content: { "application/json": { schema: SessionUrlSchema } },
    },
    409: {
      description: "The user already has a subscription (ALREADY_SUBSCRIBED).",
      content: { "application/json": { schema: ErrorSchema } },
    },
    502: {
      description: "Stripe refused the request (STRIPE_ERROR).",
      content: { "application/json": { schema: ErrorSchema } },
    },
    503: {
      description: "Billing is not configured (BILLING_NOT_CONFIGURED).",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

const portalRoute = createRoute({
  method: "post",
  path: "/v1/users/me/billing/portal",
  tags: ["Billing"],
  operationId: "createBillingPortalSession",
  summary: "Open the Stripe billing portal",
  description:
    "Creates a Stripe billing portal session where the user can update their card, see invoices or cancel, and returns its URL.",
  "x-mint": { metadata: { title: "Open the billing portal" } },
  security: [{ bearerPlatformToken: [] }],
  responses: {
    200: {
      description: "Portal session created",
      content: { "application/json": { schema: SessionUrlSchema } },
    },
    409: {
      description: "The user has no billing account yet (NO_BILLING_ACCOUNT).",
      content: { "application/json": { schema: ErrorSchema } },
    },
    502: {
      description: "Stripe refused the request (STRIPE_ERROR).",
      content: { "application/json": { schema: ErrorSchema } },
    },
    503: {
      description: "Billing is not configured (BILLING_NOT_CONFIGURED).",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

export function registerCheckoutRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(checkoutRoute, async (c) => {
    requireScope(c, "users.write");
    const user = await resolveUser(c);
    const base = consoleUrl(c);
    if (!c.env.STRIPE_SECRET_KEY || !c.env.STRIPE_PRICE_ID || !base) {
      return notConfigured(c);
    }
    const row = await billingRow(c, user.uid);
    if (!row) return notConfigured(c);

    if (
      row.stripe_subscription_id &&
      (await userPlan(c.env, user.uid)) === "pro"
    ) {
      return respond(
        c,
        {
          error: {
            code: "ALREADY_SUBSCRIBED",
            message:
              "You are already on Pro. Use the billing portal to manage it.",
          },
        },
        409,
      );
    }

    const session = await stripePost<{ url?: string }>(
      c.env,
      "/v1/checkout/sessions",
      {
        mode: "subscription",
        line_items: [{ price: c.env.STRIPE_PRICE_ID, quantity: 1 }],
        client_reference_id: user.uid,
        // Reuse the Stripe customer when there is one, so a returning user does
        // not create a duplicate; otherwise let Stripe create it from the email.
        ...(row.stripe_customer_id
          ? { customer: row.stripe_customer_id }
          : { customer_email: row.email }),
        allow_promotion_codes: true,
        metadata: { user_uid: user.uid },
        subscription_data: { metadata: { user_uid: user.uid } },
        success_url: `${base}/settings?checkout=success`,
        cancel_url: `${base}/settings?checkout=cancelled`,
      },
    );
    if (!session.ok || !session.data.url) {
      console.error("checkout session failed", {
        message: session.ok ? "no url" : session.message,
      });
      return respond(
        c,
        {
          error: {
            code: "STRIPE_ERROR",
            message: "Could not start checkout. Please try again.",
          },
        },
        502,
      );
    }
    return respond(c, { url: session.data.url });
  });

  app.openapi(portalRoute, async (c) => {
    requireScope(c, "users.write");
    const user = await resolveUser(c);
    const base = consoleUrl(c);
    if (!c.env.STRIPE_SECRET_KEY || !base) return notConfigured(c);
    const row = await billingRow(c, user.uid);
    if (!row?.stripe_customer_id) {
      return respond(
        c,
        {
          error: {
            code: "NO_BILLING_ACCOUNT",
            message: "There is no billing account to manage yet.",
          },
        },
        409,
      );
    }
    const session = await stripePost<{ url?: string }>(
      c.env,
      "/v1/billing_portal/sessions",
      { customer: row.stripe_customer_id, return_url: `${base}/settings` },
    );
    if (!session.ok || !session.data.url) {
      console.error("portal session failed", {
        message: session.ok ? "no url" : session.message,
      });
      return respond(
        c,
        {
          error: {
            code: "STRIPE_ERROR",
            message: "Could not open the billing portal. Please try again.",
          },
        },
        502,
      );
    }
    return respond(c, { url: session.data.url });
  });
}
