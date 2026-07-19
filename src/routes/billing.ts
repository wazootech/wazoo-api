import { Hono } from "hono";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../env";
import { db, first } from "../lib/db";
import { requireScope, resolveUser } from "../lib/http";

export const billing = new Hono<AppEnv>()
  .get("/worlds/:worldId/billing", async (c) => {
    requireScope(c, "billing.read");
    const user = await resolveUser(c, c.req.query("email") ?? undefined);
    const world = await resolveWorldBilling(
      c,
      user.uid,
      c.req.param("worldId"),
    );
    return c.json({
      billing: {
        world: `worlds/${world.world_id}`,
        state: world.billing_state ?? "BETA_FREE",
        provider: world.billing_provider ?? "STRIPE",
        customerConfigured: Boolean(world.stripe_customer_id),
        subscriptionConfigured: Boolean(world.stripe_subscription_id),
        paymentRequired: false,
      },
    });
  })
  .get("/worlds/:worldId/billing/invoices", async (c) => {
    requireScope(c, "billing.read");
    const user = await resolveUser(c, c.req.query("email") ?? undefined);
    await resolveWorldBilling(c, user.uid, c.req.param("worldId"));
    return c.json({ invoices: [] });
  })
  .post("/worlds/:worldId/billing/openPortal", async (c) => {
    requireScope(c, "billing.read");
    const user = await resolveUser(c, c.req.query("email") ?? undefined);
    await resolveWorldBilling(c, user.uid, c.req.param("worldId"));
    return c.json(
      {
        error: {
          code: "FAILED_PRECONDITION",
          message: "Billing portal is not available for beta-free worlds",
        },
      },
      400,
    );
  });

export const stripeWebhook = new Hono<AppEnv>().post(
  "/v1/stripe/webhook",
  async (c) => {
    if (c.env.STRIPE_WEBHOOK_SECRET) {
      const body = await c.req.text();
      const signature = c.req.header("stripe-signature");
      if (
        !signature ||
        !(await verifyStripeSignature(
          body,
          signature,
          c.env.STRIPE_WEBHOOK_SECRET,
        ))
      ) {
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
    }
    return c.json({ received: true });
  },
);

async function resolveWorldBilling(
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

async function verifyStripeSignature(
  body: string,
  header: string,
  secret: string,
): Promise<boolean> {
  const timestamp = header
    .split(",")
    .find((part) => part.startsWith("t="))
    ?.slice(2);
  const expected = header
    .split(",")
    .find((part) => part.startsWith("v1="))
    ?.slice(3);
  if (!timestamp || !expected) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const actual = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return actual === expected;
}
