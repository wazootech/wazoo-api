import { Hono } from "hono";
import type { AppEnv } from "../env";
import { first } from "../lib/db";
import { resolveOrg } from "../lib/http";

export const billing = new Hono<AppEnv>()
  .get("/organizations/:organizationId/billing", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const row = await first<{ stripe_customer_id: string | null; billing_state: string }>(
      c.env.DB.prepare("SELECT stripe_customer_id, billing_state FROM organizations WHERE id = ?").bind(organization.id)
    );
    return c.json({
      billing: {
        organization: organization.id,
        state: row?.billing_state ?? "BETA_FREE",
        provider: "STRIPE",
        customerConfigured: Boolean(row?.stripe_customer_id),
        paymentRequired: false
      }
    });
  })
  .get("/organizations/:organizationId/billing/invoices", async (c) => {
    await resolveOrg(c, c.req.param("organizationId"));
    return c.json({ invoices: [] });
  })
  .post("/organizations/:organizationId/billing\\:openPortal", async (c) => {
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
