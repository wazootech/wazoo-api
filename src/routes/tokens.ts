import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../env";
import { createToken, sha256Hex } from "../lib/crypto";
import { all, db, id } from "../lib/db";
import {
  isAdmin,
  jsonBody,
  optionalString,
  requireScope,
  requireString,
  resolveUser,
} from "../lib/http";

const defaultPlatformScopes =
  "users.read worlds.read worlds.write usage.read billing.read";

export const tokens = new Hono<AppEnv>()
  .get("/auth/api-tokens", async (c) => {
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
    return c.json({ tokens: rows });
  })
  .post("/auth/api-tokens", async (c) => {
    requireScope(c, "users.write");
    const body = await jsonBody(c);
    const user = await resolveUser(
      c,
      optionalString(body, "user") ??
        optionalString(body, "email") ??
        undefined,
    );
    return createPlatformToken(
      c,
      user.uid,
      optionalString(body, "name") ?? requireString(body, "tokenName"),
      body,
    );
  })
  .post("/auth/api-tokens/:tokenName", async (c) => {
    requireScope(c, "users.write");
    const body = await jsonBody(c).catch(() => ({}));
    const user = await resolveUser(
      c,
      optionalString(body, "user") ??
        optionalString(body, "email") ??
        undefined,
    );
    return createPlatformToken(c, user.uid, c.req.param("tokenName"), body);
  })
  .delete("/auth/api-tokens/:tokenName", async (c) => {
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
    return c.json({ token: c.req.param("tokenName") });
  })
  .get("/auth/api-tokens/validate", (c) => {
    const auth = c.get("auth");
    return c.json({
      exp: auth.expiresAt
        ? Math.floor(new Date(auth.expiresAt).getTime() / 1000)
        : 0,
    });
  });

async function createPlatformToken(
  c: Context<AppEnv>,
  userUid: string,
  name: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const scope = optionalString(body, "scope") ?? defaultPlatformScopes;
  if (scope.split(/\s+/).includes("admin")) {
    return c.json(
      {
        error: {
          code: "PERMISSION_DENIED",
          message: "Admin tokens must be manually seeded",
        },
      },
      403,
    );
  }
  const token = createToken("wzp");
  const tokenId = id();
  await db(c.env)
    .prepare(
      "INSERT INTO platform_api_tokens (uid, user_uid, name, token_hash, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(
      tokenId,
      userUid,
      name,
      await sha256Hex(token),
      scope,
      optionalString(body, "expiresAt"),
    )
    .run();
  return c.json({ uid: tokenId, name, token }, 201);
}
