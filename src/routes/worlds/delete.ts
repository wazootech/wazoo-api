import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../env";
import { db, first, now } from "../../lib/db";
import { requireScope, respond } from "../../lib/http";
import { deleteWorld } from "@worlds/client";
import { worldsAdminClient, worldsApiError } from "../../lib/worlds-client";
import { WorldSingleSchema, worldIdParam, emailQuery } from "../../lib/schemas";
import {
  currentUser,
  notFound,
  worldForUser,
  worldResource,
  type WorldRow,
} from "./shared";

const deleteRoute = createRoute({
  method: "delete",
  path: "/v1/worlds/{worldId}",
  tags: ["Worlds"],
  operationId: "deleteWorld",
  summary: "Delete world",
  "x-mint": { metadata: { title: "Delete world" } },
  security: [{ bearerPlatformToken: [] }],
  request: { params: worldIdParam, query: emailQuery },
  responses: {
    200: {
      description: "Deleted World",
      content: { "application/json": { schema: WorldSingleSchema } },
    },
    404: {
      description: "Not found",
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

export function registerDeleteWorld(app: OpenAPIHono<AppEnv>) {
  app.openapi(deleteRoute, async (c) => {
    requireScope(c, "worlds.write");
    const query = c.req.valid("query");
    const user = await currentUser(c, query.email, query.email);
    const worldId = c.req.param("worldId");
    const existing = await worldForUser(c, user.uid, worldId);
    if (!existing) return notFound(c);

    if (existing.world_id) {
      const res = await deleteWorld({
        client: worldsAdminClient(c.env),
        path: { worldId: existing.world_id },
      });
      if (res.error && res.response?.status !== 404) {
        return respond(
          c,
          {
            error: {
              code: "WORLD_DELETE_FAILED",
              message: worldsApiError(res),
            },
          },
          502,
        );
      }
    }

    const deletedAt = now();
    const expireAt = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await db(c.env)
      .prepare(
        "UPDATE worlds SET state = 'deleted', purge_status = 'pending', delete_time = ?, expire_time = ?, update_time = ? WHERE user_uid = ? AND world_id = ?",
      )
      .bind(deletedAt, expireAt, deletedAt, user.uid, existing.world_id)
      .run();
    const row = await first<WorldRow>(
      db(c.env)
        .prepare("SELECT * FROM worlds WHERE user_uid = ? AND world_id = ?")
        .bind(user.uid, existing.world_id),
    );
    return respond(c, { world: row ? worldResource(row) : null });
  });
}
