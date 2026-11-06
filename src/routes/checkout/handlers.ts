import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../env";
import { requireScope, resolveUser, respond } from "../../lib/http";
import { userPlan } from "../../lib/plans";
import { stripePost } from "../../lib/stripe";
import { checkoutRoute, portalRoute } from "./routes";
import { notConfigured, consoleUrl, billingRow } from "./shared";

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
