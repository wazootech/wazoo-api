import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../env";
import { recordAdminAudit } from "../lib/audit";
import { all, db, first, id } from "../lib/db";
import { requireScope, resolveUser, respond } from "../lib/http";
import { worldUsageQuota } from "../lib/quota";
import {
  worldIdParam,
  usageRangeQuery,
  UsageRecordRequestSchema,
  UsageSummarySchema,
  UsageAcceptedSchema,
  LimitsListSchema,
} from "../lib/schemas";

export function registerUsageRoutes(app: OpenAPIHono<AppEnv>) {
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
      const world = await resolveWorld(c, user.userId, c.req.param("worldId"));
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
            `SELECT event_id, metric, quantity, unit, provider_cost_microcents AS providerCostMicrocents, wazoo_markup_microcents AS wazooMarkupMicrocents, estimated_cost_microcents AS estimatedCostMicrocents, billing_source AS billingSource, create_time AS createTime FROM usage_events WHERE world_id = ?${range.where} ORDER BY create_time DESC LIMIT 100`,
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

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/worlds/{worldId}/limits",
      tags: ["Usage"],
      operationId: "getWorldLimits",
      summary: "Get world limits",
      "x-mint": { metadata: { title: "Get world limits" } },
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
          description: "World limits",
          content: { "application/json": { schema: LimitsListSchema } },
        },
      },
    }),
    async (c) => {
      requireScope(c, "usage.read");
      const query = c.req.valid("query");
      const user = await resolveUser(c, query.email ?? undefined);
      const world = await resolveWorld(c, user.userId, c.req.param("worldId"));
      const limits = await all(
        db(c.env)
          .prepare(
            "SELECT metric, limit_quantity AS limitQuantity FROM world_limits WHERE world_id = ? ORDER BY metric",
          )
          .bind(world.world_id),
      );
      return respond(c, { limits });
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/worlds/{worldId}/usage",
      tags: ["Usage"],
      operationId: "recordWorldUsage",
      summary: "Record world usage",
      "x-mint": { metadata: { title: "Record world usage" } },
      security: [{ bearerPlatformToken: [] }],
      request: {
        params: worldIdParam,
        body: {
          required: true,
          content: {
            "application/json": { schema: UsageRecordRequestSchema },
          },
        },
      },
      responses: {
        201: {
          description: "Usage accepted",
          content: { "application/json": { schema: UsageAcceptedSchema } },
        },
        429: {
          description: "Limit exceeded",
          content: {
            "application/json": {
              schema: z.object({
                error: z.object({ code: z.string(), message: z.string() }),
                quota: z.object({
                  state: z.string(),
                  reason: z.string().optional(),
                }),
              }),
            },
          },
        },
      },
    }),
    async (c) => {
      requireScope(c, "admin");
      const body = c.req.valid("json");
      const user = await resolveUser(c, body.user ?? body.email ?? undefined);
      const world = await resolveWorld(c, user.userId, c.req.param("worldId"));
      const database = db(c.env);
      const limit = await first<{ limit_quantity: number }>(
        database
          .prepare(
            "SELECT limit_quantity FROM world_limits WHERE world_id = ? AND metric = ?",
          )
          .bind(world.world_id, body.metric),
      );
      if (limit) {
        const current = await first<{ quantity: number }>(
          database
            .prepare(
              "SELECT COALESCE(SUM(quantity), 0) AS quantity FROM usage_events WHERE world_id = ? AND metric = ?",
            )
            .bind(world.world_id, body.metric),
        );
        if ((current?.quantity ?? 0) + body.quantity > limit.limit_quantity) {
          return respond(
            c,
            {
              error: {
                code: "RESOURCE_EXHAUSTED",
                message: `Limit exceeded for ${body.metric}`,
              },
              quota: {
                state: "THROTTLED",
                reason: `${body.metric.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_EXCEEDED`,
              },
            },
            429,
          );
        }
      }
      await database
        .prepare(
          "INSERT INTO usage_events (event_id, user_id, world_id, metric, quantity, unit, provider_cost_microcents, wazoo_markup_microcents, estimated_cost_microcents, billing_source, create_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          id(),
          user.userId,
          world.world_id,
          body.metric,
          body.quantity,
          body.unit,
          body.providerCostMicrocents ?? null,
          body.wazooMarkupMicrocents,
          body.estimatedCostMicrocents ?? null,
          body.billingSource,
          body.createTime ?? new Date().toISOString(),
        )
        .run();
      await recordAdminAudit(c, {
        action: "usage.record",
        targetResourceName: `worlds/${world.world_id}/usageEvents`,
      });
      return respond(c, { accepted: true }, 201);
    },
  );
}

async function resolveWorld(
  c: Context<AppEnv>,
  userId: string,
  worldId: string,
): Promise<{ world_id: string }> {
  const world = await first<{ world_id: string }>(
    db(c.env)
      .prepare("SELECT world_id FROM worlds WHERE user_id = ? AND world_id = ?")
      .bind(userId, worldId),
  );
  if (!world) throw new HTTPException(404, { message: "World not found" });
  return world;
}

type UsageEventRow = {
  event_id: string;
  metric: string;
  quantity: number;
  unit: string;
  providerCostMicrocents?: number | null;
  wazooMarkupMicrocents?: number;
  estimatedCostMicrocents?: number | null;
  billingSource: string;
  createTime: string;
};

function usageEventResource(row: UsageEventRow) {
  return {
    name: `usageEvents/${row.event_id}`,
    eventId: row.event_id,
    metric: row.metric,
    quantity: row.quantity,
    unit: row.unit,
    providerCostMicrocents: row.providerCostMicrocents,
    wazooMarkupMicrocents: row.wazooMarkupMicrocents,
    estimatedCostMicrocents: row.estimatedCostMicrocents,
    billingSource: row.billingSource,
    createTime: row.createTime,
  };
}

function usageRange(query: { from?: string; to?: string }) {
  const args: string[] = [];
  let where = "";
  if (query.from) {
    where += " AND create_time >= ?";
    args.push(query.from);
  }
  if (query.to) {
    where += " AND create_time <= ?";
    args.push(query.to);
  }
  return { where, args };
}
