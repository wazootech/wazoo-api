import { Hono } from "hono";
import type { AppEnv } from "../env";
import { db, first } from "../lib/db";
import { requireScope, resolveOrg } from "../lib/http";

export const billing = new Hono<AppEnv>()
  .get("/organizations/:organizationId/billing", async (c) => {
    requireScope(c, "billing.read");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const row = await first<{ billing_provider: string; stripe_customer_id: string | null; stripe_subscription_id: string | null; billing_state: string }>(
      db(c.env).prepare("SELECT billing_provider, stripe_customer_id, stripe_subscription_id, billing_state FROM organizations WHERE id = ?").bind(organization.id)
    );
    return c.json({
      billing: {
        organization: organization.id,
        state: row?.billing_state ?? "BETA_FREE",
        provider: row?.billing_provider ?? "STRIPE",
        customerConfigured: Boolean(row?.stripe_customer_id),
        subscriptionConfigured: Boolean(row?.stripe_subscription_id),
        paymentRequired: false
      }
    });
  })
  .get("/organizations/:organizationId/billing/invoices", async (c) => {
    requireScope(c, "billing.read");
    await resolveOrg(c, c.req.param("organizationId"));
    return c.json({ invoices: [] });
  })
  .post("/organizations/:organizationId/billing\\:openPortal", async (c) => {
    requireScope(c, "billing.read");
    await resolveOrg(c, c.req.param("organizationId"));
    return c.json(
      {
        error: {
          code: "FAILED_PRECONDITION",
          message: "Billing portal is not available for beta-free organizations"
        }
      },
      400
    );
  });

export const stripeWebhook = new Hono<AppEnv>().post("/v1/stripe/webhook", (c) => {
  return c.json({ received: true });
});
