import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../env";
import { all, db } from "../../lib/db";
import { requireScope, resolveUser, respond } from "../../lib/http";
import { worldIdParam, LimitsListSchema } from "../../lib/schemas";
import { resolveWorld } from "./shared";

export function registerRecordUsage(app: OpenAPIHono<AppEnv>) {
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
      const world = await resolveWorld(c, user.uid, c.req.param("worldId"));
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
}
