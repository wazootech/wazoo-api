import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../env";
import { db } from "../../lib/db";
import { requireScope, resolveUser, respond } from "../../lib/http";
import { worldIdParam } from "../../lib/schemas";
import { resolveWorldBilling } from "./shared";

export function registerCancelWorldSubscription(app: OpenAPIHono<AppEnv>) {
  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/worlds/{worldId}/billing/cancel",
      tags: ["Billing"],
      operationId: "cancelWorldSubscription",
      summary: "Cancel world subscription",
      "x-mint": { metadata: { title: "Cancel world subscription" } },
      security: [{ bearerPlatformToken: [] }],
      request: {
        params: worldIdParam,
        query: z.object({
          email: z
            .string()
            .optional()
            .openapi({ param: { name: "email", in: "query" } }),
        }),
      },
      responses: {
        200: {
          description: "Cancelled subscription",
          content: {
            "application/json": {
              schema: z.object({
                billing: z.object({
                  world: z.string(),
                  state: z.string(),
                  provider: z.string(),
                  customerConfigured: z.boolean(),
                  subscriptionConfigured: z.boolean(),
                  paymentRequired: z.boolean(),
                }),
              }),
            },
          },
        },
        400: {
          description: "No subscription to cancel",
          content: {
            "application/json": {
              schema: z.object({
                error: z.object({ code: z.string(), message: z.string() }),
              }),
            },
          },
        },
      },
    }),
    async (c) => {
      // Billing is a beta stub module; session tokens carry billing.read.
      requireScope(c, "billing.read");
      const query = c.req.valid("query");
      const user = await resolveUser(c, query.email ?? undefined);
      const world = await resolveWorldBilling(
        c,
        user.uid,
        c.req.param("worldId"),
      );

      // No configured subscription (beta free tier): nothing to cancel. Keep
      // the click-to-cancel contract honest rather than silently no-oping.
      if (!world.stripe_subscription_id) {
        return respond(
          c,
          {
            error: {
              code: "FAILED_PRECONDITION",
              message:
                "This world is on the free beta tier and has no subscription to cancel.",
            },
          },
          400,
        );
      }

      // Cancel at the provider (Stripe) when configured. Cancels immediately;
      // no interstitial upsells, matching the FTC click-to-cancel expectation.
      if (c.env.STRIPE_SECRET_KEY) {
        const res = await fetch(
          `https://api.stripe.com/v1/subscriptions/${world.stripe_subscription_id}`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}`,
            },
          },
        );
        if (!res.ok) {
          return respond(
            c,
            {
              error: {
                code: "CANCEL_FAILED",
                message: "Could not cancel the subscription at the provider.",
              },
            },
            502,
          );
        }
      }

      await db(c.env)
        .prepare(
          "UPDATE worlds SET billing_state = 'CANCELLED', stripe_subscription_id = NULL, update_time = ? WHERE world_id = ?",
        )
        .bind(new Date().toISOString(), world.world_id)
        .run();

      const updated = await resolveWorldBilling(
        c,
        user.uid,
        c.req.param("worldId"),
      );
      return respond(c, {
        billing: {
          world: `worlds/${updated.world_id}`,
          state: updated.billing_state ?? "BETA_FREE",
          provider: updated.billing_provider ?? "STRIPE",
          customerConfigured: Boolean(updated.stripe_customer_id),
          subscriptionConfigured: Boolean(updated.stripe_subscription_id),
          paymentRequired:
            updated.billing_state === "PAST_DUE" ||
            updated.billing_state === "UNPAID",
        },
      });
    },
  );
}
