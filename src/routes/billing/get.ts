import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../env";
import { all, db } from "../../lib/db";
import { requireScope, resolveUser, respond } from "../../lib/http";
import { worldBillingQuota } from "../../lib/quota";
import { worldIdParam, BillingResponseSchema } from "../../lib/schemas";
import { resolveWorldBilling } from "./shared";

export function registerGetWorldBilling(app: OpenAPIHono<AppEnv>) {
  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/worlds/{worldId}/billing",
      tags: ["Billing"],
      operationId: "getWorldBilling",
      summary: "Get world billing",
      "x-mint": { metadata: { title: "Get world billing" } },
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
          description: "World billing state",
          content: { "application/json": { schema: BillingResponseSchema } },
        },
      },
    }),
    async (c) => {
      requireScope(c, "billing.read");
      const query = c.req.valid("query");
      const user = await resolveUser(c, query.email ?? undefined);
      const world = await resolveWorldBilling(
        c,
        user.uid,
        c.req.param("worldId"),
      );
      const totals = await all<{ metric: string; quantity: number }>(
        db(c.env)
          .prepare(
            "SELECT metric, SUM(quantity) AS quantity FROM usage_events WHERE world_id = ? GROUP BY metric",
          )
          .bind(world.world_id),
      );
      const quota = await worldBillingQuota(
        c,
        user.uid,
        world.world_id,
        totals,
      );
      return respond(c, {
        billing: {
          world: `worlds/${world.world_id}`,
          state: world.billing_state ?? "BETA_FREE",
          provider: world.billing_provider ?? "STRIPE",
          customerConfigured: Boolean(world.stripe_customer_id),
          subscriptionConfigured: Boolean(world.stripe_subscription_id),
          // Payment is required when a billing state indicates an outstanding
          // balance; derived from the database, never hardcoded.
          paymentRequired:
            world.billing_state === "PAST_DUE" ||
            world.billing_state === "UNPAID",
        },
        quota,
      });
    },
  );
}
