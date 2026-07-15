import { Hono } from "hono";
import type { AppEnv } from "../env";
import { db, first } from "../lib/db";
import { requireScope, resolveOrg } from "../lib/http";

export const billing = new Hono<AppEnv>()
  .get("/organizations/:organizationId/billing", async (c) => {
    requireScope(c, "billing.read");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const row = await first<{ billing_provider: string; stripe_customer_id: string | null; stripe_subscription_id: string | null; billing_state: string }>(
      db(c.env).prepare("SELECT billing_provider, stripe_customer_id, stripe_subscription_id, billing_state FROM organizations WHERE uid = ?").bind(organization.uid)
    );
    return c.json({
      billing: {
        organization: `organizations/${organization.organizationId}`,
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

export const stripeWebhook = new Hono<AppEnv>().post("/v1/stripe/webhook", async (c) => {
  if (c.env.STRIPE_WEBHOOK_SECRET) {
    const body = await c.req.text();
    const signature = c.req.header("stripe-signature");
    if (!signature || !await verifyStripeSignature(body, signature, c.env.STRIPE_WEBHOOK_SECRET)) {
      return c.json({ error: { code: "UNAUTHENTICATED", message: "Invalid Stripe webhook signature" } }, 401);
    }
  }
  return c.json({ received: true });
});

async function verifyStripeSignature(body: string, header: string, secret: string): Promise<boolean> {
  const timestamp = header.split(",").find((part) => part.startsWith("t="))?.slice(2);
  const expected = header.split(",").find((part) => part.startsWith("v1="))?.slice(3);
  if (!timestamp || !expected) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  const actual = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return actual === expected;
}
