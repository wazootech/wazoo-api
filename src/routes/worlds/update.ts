import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";
import type { AppEnv } from "../../env";
import { db, first, now } from "../../lib/db";
import { requireScope, respond } from "../../lib/http";
import { updateWorld } from "@worlds/client";
import { worldsAdminClient, worldsApiError } from "../../lib/worlds-client";
import {
  UpdateWorldBodySchema,
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

const updateRoute = createRoute({
  method: "patch",
  path: "/v1/worlds/{worldId}",
  tags: ["Worlds"],
  operationId: "updateWorld",
  summary: "Update world",
  "x-mint": { metadata: { title: "Update world" } },
  security: [{ bearerPlatformToken: [] }],
  request: {
    params: worldIdParam,
    query: emailQuery,
    body: {
      required: true,
      content: { "application/json": { schema: UpdateWorldBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Updated World",
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

export function registerUpdateWorld(app: OpenAPIHono<AppEnv>) {
  app.openapi(updateRoute, async (c) => {
    requireScope(c, "worlds.write");
    const query = c.req.valid("query");
    const user = await currentUser(c, query.email, query.email);
    const existing = await worldForUser(c, user.uid, c.req.param("worldId"));
    if (!existing) return notFound(c);

    const body = c.req.valid("json");
    const updateMask = body.updateMask
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean);
    const allowed = new Set(["displayName", "region", "state"]);
    if (updateMask.some((field) => !allowed.has(field))) {
      return respond(
        c,
        {
          error: {
            code: "INVALID_ARGUMENT",
            message: "updateMask contains unknown fields",
          },
        },
        400,
      );
    }
    const patch = body.world;
    const nextState = updateMask.includes("state")
      ? (patch.state?.toUpperCase() ?? null)
      : null;
    if (nextState && nextState !== "ACTIVE" && nextState !== "SUSPENDED") {
      return respond(
        c,
        {
          error: {
            code: "INVALID_ARGUMENT",
            message: "state can only be patched to ACTIVE or SUSPENDED",
          },
        },
        400,
      );
    }

    await db(c.env)
      .prepare(
        "UPDATE worlds SET display_name = COALESCE(?, display_name), region = COALESCE(?, region), state = COALESCE(?, state), update_time = ? WHERE user_uid = ? AND world_id = ?",
      )
      .bind(
        updateMask.includes("displayName") ? (patch.displayName ?? null) : null,
        updateMask.includes("region") ? (patch.region ?? null) : null,
        nextState?.toLowerCase() ?? null,
        now(),
        user.uid,
        existing.world_id,
      )
      .run();

    if (updateMask.includes("displayName") && patch.displayName) {
      if (existing.world_id) {
        const res = await updateWorld({
          client: worldsAdminClient(c.env),
          path: { worldId: existing.world_id },
          body: { displayName: patch.displayName },
        });
        if (res.error) {
          return respond(
            c,
            {
              error: {
                code: "WORLD_UPDATE_FAILED",
                message: worldsApiError(res),
              },
            },
            502,
          );
        }
      }
    }

    const row = await first<WorldRow>(
      db(c.env)
        .prepare("SELECT * FROM worlds WHERE user_uid = ? AND world_id = ?")
        .bind(user.uid, existing.world_id),
    );
    return respond(c, { world: row ? worldResource(row) : null });
  });
}
