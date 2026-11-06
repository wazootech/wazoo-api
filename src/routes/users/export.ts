import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../env";
import { db } from "@/lib/db";
import { requireScope, respond } from "@/lib/http";
import { requireUserToken, userResource, type UserRow } from "./shared";

import { exportRoute } from "./export-route";

export function registerExportUser(app: OpenAPIHono<AppEnv>) {
  app.openapi(exportRoute, async (c) => {
    requireScope(c, "users.read");
    const { userUid } = requireUserToken(c);
    const database = db(c.env);

    const user = await database
      .prepare(
        "SELECT uid, email, display_name, create_time FROM users WHERE uid = ?",
      )
      .bind(userUid)
      .first<UserRow>();
    if (!user) {
      return respond(
        c,
        { error: { code: "NOT_FOUND", message: "User not found" } },
        404,
      );
    }

    const worlds = await database
      .prepare(
        "SELECT world_id, display_name, state, create_time, delete_time FROM worlds WHERE user_uid = ?",
      )
      .bind(userUid)
      .all<{
        world_id: string;
        display_name: string;
        state: string;
        create_time: string;
        delete_time: string | null;
      }>();

    const apiTokens = await database
      .prepare(
        "SELECT uid, name, scope, create_time FROM platform_api_tokens WHERE user_uid = ? AND kind != 'ADMIN'",
      )
      .bind(userUid)
      .all<{
        uid: string;
        name: string;
        scope: string;
        create_time: string;
      }>();

    const usageEvents = await database
      .prepare(
        "SELECT metric, quantity, unit, create_time FROM usage_events WHERE user_uid = ?",
      )
      .bind(userUid)
      .all<{
        metric: string;
        quantity: number;
        unit: string;
        create_time: string;
      }>();

    return respond(c, {
      user: userResource(user),
      worlds: (worlds.results ?? []).map((w) => ({
        id: w.world_id,
        displayName: w.display_name,
        state: w.state,
        createTime: w.create_time,
        deleteTime: w.delete_time,
      })),
      apiTokens: (apiTokens.results ?? []).map((t) => ({
        uid: t.uid,
        name: t.name,
        scope: t.scope,
        createTime: t.create_time,
      })),
      usageEvents: (usageEvents.results ?? []).map((e) => ({
        metric: e.metric,
        quantity: e.quantity,
        unit: e.unit,
        createTime: e.create_time,
      })),
    });
  });
}
