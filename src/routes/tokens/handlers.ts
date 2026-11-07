import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../env";
import { all, db } from "../../lib/db";
import { isAdmin, requireScope, resolveUser, respond } from "../../lib/http";
import { createPlatformToken } from "./create";
import {
  listRoute,
  createRouteDef,
  createNamedRoute,
  deleteRoute,
  validateRoute,
} from "./routes";

export function registerTokensRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(listRoute, async (c) => {
    requireScope(c, "users.read");
    const auth = c.get("auth");
    const database = db(c.env);
    const rows = auth.userUid
      ? await all(
          database
            .prepare(
              "SELECT uid, name, scope, last_used_at, expires_at, create_time AS createTime FROM platform_api_tokens WHERE user_uid = ? AND kind != 'ADMIN' ORDER BY create_time DESC",
            )
            .bind(auth.userUid),
        )
      : await all(
          database.prepare(
            "SELECT uid, name, scope, last_used_at, expires_at, create_time AS createTime FROM platform_api_tokens WHERE kind != 'ADMIN' ORDER BY create_time DESC",
          ),
        );
    return respond(c, { tokens: rows });
  });

  app.openapi(createRouteDef, async (c) => {
    requireScope(c, "users.write");
    const body = c.req.valid("json");
    const user = await resolveUser(c, body.user ?? body.email ?? undefined);
    return createPlatformToken(
      c,
      user.uid,
      body.tokenName ?? body.name ?? "",
      body,
    );
  });

  app.openapi(createNamedRoute, async (c) => {
    requireScope(c, "users.write");
    const body = c.req.valid("json");
    const user = await resolveUser(c, body.user ?? body.email ?? undefined);
    return createPlatformToken(c, user.uid, c.req.param("tokenName"), body);
  });

  app.openapi(deleteRoute, async (c) => {
    requireScope(c, "users.write");
    const auth = c.get("auth");
    if (auth.userUid) {
      await db(c.env)
        .prepare(
          "DELETE FROM platform_api_tokens WHERE user_uid = ? AND name = ? AND kind != 'ADMIN'",
        )
        .bind(auth.userUid, c.req.param("tokenName"))
        .run();
    } else if (isAdmin(c)) {
      await db(c.env)
        .prepare(
          "DELETE FROM platform_api_tokens WHERE name = ? AND kind != 'ADMIN'",
        )
        .bind(c.req.param("tokenName"))
        .run();
    }
    return respond(c, { token: c.req.param("tokenName") });
  });

  app.openapi(validateRoute, (c) => {
    const auth = c.get("auth");
    return respond(c, {
      exp: auth.expiresAt
        ? Math.floor(new Date(auth.expiresAt).getTime() / 1000)
        : 0,
    });
  });
}
