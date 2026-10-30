import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../env";
import { all, db } from "../../lib/db";
import { requireScope, resolveUser, respond } from "../../lib/http";
import { worldUsageQuota } from "../../lib/quota";
import {
  worldIdParam,
  usageRangeQuery,
  UsageSummarySchema,
} from "../../lib/schemas";
import {
  resolveWorld,
  usageEventResource,
  usageRange,
  type UsageEventRow,
} from "./shared";

export function registerUsageSummary(app: OpenAPIHono<AppEnv>) {
  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/worlds/{worldId}/usage",
      tags: ["Usage"],
      operationId: "getWorldUsage",
      summary: "Get world usage",
      "x-mint": { metadata: { title: "Get world usage" } },
      security: [{ bearerPlatformToken: [] }],
      request: { params: worldIdParam, query: usageRangeQuery },
      responses: {
        200: {
          description: "Usage summary",
          content: { "application/json": { schema: UsageSummarySchema } },
        },
      },
    }),
    async (c) => {
      requireScope(c, "usage.read");
      const query = c.req.valid("query");
      const user = await resolveUser(c, query.email ?? undefined);
      const world = await resolveWorld(c, user.uid, c.req.param("worldId"));
      const range = usageRange(query);
      const database = db(c.env);
      const rows = await all<{ metric: string; quantity: number }>(
        database
          .prepare(
            `SELECT metric, SUM(quantity) AS quantity FROM usage_events WHERE world_id = ?${range.where} GROUP BY metric ORDER BY metric`,
          )
          .bind(world.world_id, ...range.args),
      );
      const eventRows = await all<UsageEventRow>(
        database
          .prepare(
            `SELECT uid, metric, quantity, unit, provider_cost_microcents AS providerCostMicrocents, wazoo_markup_microcents AS wazooMarkupMicrocents, estimated_cost_microcents AS estimatedCostMicrocents, billing_source AS billingSource, create_time AS createTime FROM usage_events WHERE world_id = ?${range.where} ORDER BY create_time DESC LIMIT 100`,
          )
          .bind(world.world_id, ...range.args),
      );
      const quota = await worldUsageQuota(c, world.world_id, rows);
      return respond(c, {
        usage: {
          world: `worlds/${world.world_id}`,
          total: rows,
          events: eventRows.map(usageEventResource),
        },
        quota,
      });
    },
  );
}
