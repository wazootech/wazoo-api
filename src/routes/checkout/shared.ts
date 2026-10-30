import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppEnv } from "../../env";
import { db, first } from "../../lib/db";
import { respond } from "../../lib/http";

export const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export const SessionUrlSchema = z
  .object({
    url: z.string().url().openapi({
      description:
        "The Stripe-hosted page to send the user to. It is single-use and expires.",
    }),
  })
  .openapi("BillingSessionUrl");

export const notConfigured = (c: Context<AppEnv>) =>
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
export function consoleUrl(c: Context<AppEnv>): string | null {
  const url = c.env.CONSOLE_URL?.replace(/\/+$/, "");
  return url && /^https?:\/\//.test(url) ? url : null;
}

export type UserBillingRow = {
  uid: string;
  email: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

export async function billingRow(c: Context<AppEnv>, uid: string) {
  return first<UserBillingRow>(
    db(c.env)
      .prepare(
        "SELECT uid, email, stripe_customer_id, stripe_subscription_id FROM users WHERE uid = ?",
      )
      .bind(uid),
  );
}
