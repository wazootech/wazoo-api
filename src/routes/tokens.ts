import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppEnv } from "../env";
import { createToken, sha256Hex } from "../lib/crypto";
import { all, db, id } from "../lib/db";
import { isAdmin, requireScope, resolveUser, respond } from "../lib/http";
import { TOKEN_DEFAULT_SCOPES } from "../lib/scopes";
import {
  PlatformTokenSchema,
  PlatformTokenCreateRequestSchema,
  PlatformTokenCreateResponseSchema,
  PlatformTokenDeleteResponseSchema,
  PlatformTokenValidateResponseSchema,
  tokenNameParam,
} from "../lib/schemas";

const listRoute = createRoute({
  method: "get",
  path: "/v1/auth/api-tokens",
  tags: ["PlatformTokens"],
  operationId: "listPlatformTokens",
  summary: "List platform tokens",
  security: [{ bearerPlatformToken: [] }],
  responses: {
    200: {
      description: "Platform tokens",
      content: {
        "application/json": {
          schema: z.object({ tokens: z.array(PlatformTokenSchema) }),
        },
      },
    },
  },
});

const createRouteDef = createRoute({
  method: "post",
  path: "/v1/auth/api-tokens",
  tags: ["PlatformTokens"],
  operationId: "createPlatformToken",
  summary: "Create platform token",
  security: [{ bearerPlatformToken: [] }],
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: PlatformTokenCreateRequestSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Created platform token",
      content: {
        "application/json": { schema: PlatformTokenCreateResponseSchema },
      },
    },
    403: {
      description: "Permission denied",
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

const createNamedRoute = createRoute({
  method: "post",
  path: "/v1/auth/api-tokens/{tokenName}",
  tags: ["PlatformTokens"],
  operationId: "createNamedPlatformToken",
  summary: "Create named platform token",
  security: [{ bearerPlatformToken: [] }],
  request: {
    params: tokenNameParam,
    body: {
      content: {
        "application/json": { schema: PlatformTokenCreateRequestSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Created platform token",
      content: {
        "application/json": { schema: PlatformTokenCreateResponseSchema },
      },
    },
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/v1/auth/api-tokens/{tokenName}",
  tags: ["PlatformTokens"],
  operationId: "deletePlatformToken",
  summary: "Revoke platform token",
  security: [{ bearerPlatformToken: [] }],
  request: { params: tokenNameParam },
  responses: {
    200: {
      description: "Deleted platform token",
      content: {
        "application/json": { schema: PlatformTokenDeleteResponseSchema },
      },
    },
  },
});

const validateRoute = createRoute({
  method: "get",
  path: "/v1/auth/api-tokens/validate",
  tags: ["PlatformTokens"],
  operationId: "validatePlatformToken",
  summary: "Validate platform token",
  security: [{ bearerPlatformToken: [] }],
  responses: {
    200: {
      description: "Token validity",
      content: {
        "application/json": { schema: PlatformTokenValidateResponseSchema },
      },
    },
  },
});

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

async function createPlatformToken(
  c: Context<AppEnv>,
  userUid: string,
  name: string,
  body: { scope?: string; expiresAt?: string },
) {
  const scope = body.scope ?? TOKEN_DEFAULT_SCOPES;
  if (scope.split(/\s+/).includes("admin")) {
    return respond(
      c,
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
      body.expiresAt ?? null,
    )
    .run();
  return respond(c, { uid: tokenId, name, token }, 201);
}
