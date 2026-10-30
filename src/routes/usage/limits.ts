import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../env";
import { recordAdminAudit } from "../../lib/audit";
import { db, first, id } from "../../lib/db";
import { requireScope, resolveUser, respond } from "../../lib/http";
import {
  worldIdParam,
  UsageRecordRequestSchema,
  UsageAcceptedSchema,
} from "../../lib/schemas";
import { resolveWorld } from "./shared";

export function registerListLimits(app: OpenAPIHono<AppEnv>) {
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
      const world = await resolveWorld(c, user.uid, c.req.param("worldId"));
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
          "INSERT INTO usage_events (uid, user_uid, world_id, metric, quantity, unit, provider_cost_microcents, wazoo_markup_microcents, estimated_cost_microcents, billing_source, create_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          id(),
          user.uid,
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
