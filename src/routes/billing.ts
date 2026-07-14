import { Hono } from "hono";
import type { AppEnv } from "../env";
import { resolveOrg } from "../lib/http";

export const billing = new Hono<AppEnv>().get("/organizations/:organizationId/billing", async (c) => {
  const organization = await resolveOrg(c, c.req.param("organizationId"));
  return c.json({ billing: {
    organizationId: organization.id,
    status: "not_configured",
    provider: "stripe",
    priceId: c.env.STRIPE_PRICE_ID || null,
    message: "Billing is a placeholder. Add Stripe checkout, portal, and webhooks before charging customers."
  } });
});
