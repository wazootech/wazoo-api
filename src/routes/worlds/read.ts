import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../env";
import { all, db } from "../../lib/db";
import { requireScope, respond } from "../../lib/http";
import {
  WorldListSchema,
  WorldSingleSchema,
  worldIdParam,
  emailQuery,
} from "../../lib/schemas";
import {
  currentUser,
  notFound,
  worldForUser,
  worldResource,
  type WorldRow,
} from "./shared";

const listRoute = createRoute({
  method: "get",
  path: "/v1/worlds",
  tags: ["Worlds"],
  operationId: "listWorlds",
  summary: "List worlds",
  "x-mint": { metadata: { title: "List worlds" } },
  security: [{ bearerPlatformToken: [] }],
  request: { query: emailQuery },
  responses: {
    200: {
      description: "World list",
      content: { "application/json": { schema: WorldListSchema } },
    },
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/v1/worlds/{worldId}",
  tags: ["Worlds"],
  operationId: "getWorld",
  summary: "Get world",
  "x-mint": { metadata: { title: "Get world" } },
  security: [{ bearerPlatformToken: [] }],
  request: { params: worldIdParam, query: emailQuery },
  responses: {
    200: {
      description: "World",
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

export function registerListWorlds(app: OpenAPIHono<AppEnv>) {
  app.openapi(listRoute, async (c) => {
    requireScope(c, "worlds.read");
    const query = c.req.valid("query");
    const user = await currentUser(c, query.email, query.email);
    const rows = await all<WorldRow>(
      db(c.env)
        .prepare(
          "SELECT * FROM worlds WHERE user_uid = ? AND state != 'deleted' ORDER BY create_time DESC",
        )
        .bind(user.uid),
    );
    return respond(c, { worlds: rows.map(worldResource) });
  });
}

export function registerGetWorld(app: OpenAPIHono<AppEnv>) {
  app.openapi(getRoute, async (c) => {
    requireScope(c, "worlds.read");
    const query = c.req.valid("query");
    const user = await currentUser(c, query.email, query.email);
    const world = await worldForUser(c, user.uid, c.req.param("worldId"));
    if (!world) return notFound(c);
    return respond(c, { world: worldResource(world) });
  });
}
