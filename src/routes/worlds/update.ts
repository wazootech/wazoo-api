import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../env";
import { db, first, now } from "../../lib/db";
import { requireScope, respond } from "../../lib/http";
import { updateWorld } from "@worlds/client";
import { worldsAdminClient, worldsApiError } from "../../lib/worlds-client";
import {
  nextStateOf,
  pauseWorldConfirmed,
  resumeWorldConfirmed,
  statePatchError,
} from "./lifecycle-writes";
import { updateRoute } from "./routes-update";
import {
  currentUser,
  notFound,
  worldForUser,
  worldResource,
  type WorldRow,
} from "./shared";

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
    const nextState = nextStateOf(updateMask, patch);
    const stateError = statePatchError(patch, nextState);
    if (stateError) {
      return respond(
        c,
        { error: { code: "INVALID_ARGUMENT", message: stateError } },
        400,
      );
    }

    if (nextState !== null && existing.world_id) {
      // Awaited worlds-api lifecycle write first: the local row only moves
      // after worlds-api confirms, so a failure never reports success on
      // one side only.
      const failure =
        nextState === "SUSPENDED"
          ? await pauseWorldConfirmed(
              c.env,
              existing.world_id,
              patch.pauseDurationSeconds!,
            )
          : await resumeWorldConfirmed(c.env, existing.world_id);
      if (failure) {
        return respond(c, failure.body, failure.status);
      }
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
