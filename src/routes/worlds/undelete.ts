import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../env";
import { db, first, now } from "../../lib/db";
import { isAdmin, requireScope, respond } from "../../lib/http";
import {
  activeWorldCount,
  privateBetaQuota,
  quotaError,
} from "../../lib/quota";
import { undeleteWorld } from "@worlds/client";
import { worldsAdminClient, worldsApiError } from "../../lib/worlds-client";
import { WorldSingleSchema, worldIdParam, emailQuery } from "../../lib/schemas";
import {
  currentUser,
  notFound,
  worldForUser,
  worldResource,
  type WorldRow,
} from "./shared";

const undeleteRoute = createRoute({
  method: "post",
  path: "/v1/worlds/{worldId}/undelete",
  tags: ["Worlds"],
  operationId: "undeleteWorld",
  summary: "Undelete world",
  "x-mint": { metadata: { title: "Undelete world" } },
  security: [{ bearerPlatformToken: [] }],
  request: { params: worldIdParam, query: emailQuery },
  responses: {
    200: {
      description: "Restored World",
      content: { "application/json": { schema: WorldSingleSchema } },
    },
    400: {
      description: "Bad request",
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({ code: z.string(), message: z.string() }),
          }),
        },
      },
    },
  },
});

export function registerUndeleteWorld(app: OpenAPIHono<AppEnv>) {
  app.openapi(undeleteRoute, async (c) => {
    requireScope(c, "worlds.write");
    const query = c.req.valid("query");
    const user = await currentUser(c, query.email, query.email);
    const worldId = c.req.param("worldId");
    const existing = await worldForUser(c, user.uid, worldId);
    if (!existing) return notFound(c);
    if (existing.state !== "deleted")
      return respond(
        c,
        {
          error: {
            code: "FAILED_PRECONDITION",
            message: "World is not deleted",
          },
        },
        400,
      );
    if (
      existing.expire_time &&
      new Date(existing.expire_time).getTime() <= Date.now()
    ) {
      return respond(
        c,
        {
          error: {
            code: "WORLD_RESTORE_EXPIRED",
            message: "World undelete window has expired",
          },
        },
        400,
      );
    }
    const activeCount = await activeWorldCount(c, user.uid);
    if (!isAdmin(c) && activeCount >= privateBetaQuota.maxWorlds) {
      return quotaError(c, "Maximum active Worlds exceeded", {
        state: "THROTTLED",
        reason: "MAX_WORLDS_EXCEEDED",
        usagePercent: 100,
      });
    }
    if (existing.world_id) {
      const res = await undeleteWorld({
        client: worldsAdminClient(c.env),
        path: { worldId: existing.world_id },
      });
      if (res.error) {
        return respond(
          c,
          {
            error: {
              code: "WORLD_UNDELETE_FAILED",
              message: worldsApiError(res),
            },
          },
          502,
        );
      }
    }

    await db(c.env)
      .prepare(
        "UPDATE worlds SET state = 'active', delete_time = NULL, expire_time = NULL, update_time = ? WHERE user_uid = ? AND world_id = ?",
      )
      .bind(now(), user.uid, existing.world_id)
      .run();
    const row = await first<WorldRow>(
      db(c.env)
        .prepare("SELECT * FROM worlds WHERE user_uid = ? AND world_id = ?")
        .bind(user.uid, existing.world_id),
    );
    return respond(c, { world: row ? worldResource(row) : null });
  });
}
