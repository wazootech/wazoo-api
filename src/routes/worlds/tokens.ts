import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../../env";
import { requireScope, respond } from "../../lib/http";
import { createApiKey, deleteApiKey, listApiKeys } from "@worlds/client";
import { worldsAdminClient, worldsApiError } from "../../lib/worlds-client";
import {
  WorldTokenListSchema,
  WorldTokenCreateRequestSchema,
  WorldTokenSingleResponseSchema,
  worldIdParam,
  emailQuery,
} from "../../lib/schemas";
import { currentUser, notFound, worldForUser } from "./shared";

const listTokensRoute = createRoute({
  method: "get",
  path: "/v1/worlds/{worldId}/auth/tokens",
  tags: ["WorldTokens"],
  operationId: "listWorldTokens",
  summary: "List world tokens",
  "x-mint": { metadata: { title: "List world tokens" } },
  security: [{ bearerPlatformToken: [] }],
  request: { params: worldIdParam, query: emailQuery },
  responses: {
    200: {
      description: "World tokens",
      content: { "application/json": { schema: WorldTokenListSchema } },
    },
  },
});

const createTokenRoute = createRoute({
  method: "post",
  path: "/v1/worlds/{worldId}/auth/tokens",
  tags: ["WorldTokens"],
  operationId: "createWorldToken",
  summary: "Create world token",
  "x-mint": { metadata: { title: "Create world token" } },
  security: [{ bearerPlatformToken: [] }],
  request: {
    params: worldIdParam,
    query: emailQuery,
    body: {
      content: {
        "application/json": { schema: WorldTokenCreateRequestSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Created World token",
      content: {
        "application/json": { schema: WorldTokenSingleResponseSchema },
      },
    },
  },
});

const deleteTokenRoute = createRoute({
  method: "delete",
  path: "/v1/worlds/{worldId}/auth/tokens/{tokenUid}",
  tags: ["WorldTokens"],
  operationId: "deleteWorldToken",
  summary: "Revoke world token",
  "x-mint": { metadata: { title: "Revoke world token" } },
  security: [{ bearerPlatformToken: [] }],
  request: {
    params: worldIdParam.merge(
      z.object({
        tokenUid: z.string().openapi({
          param: { name: "tokenUid", in: "path", required: true },
        }),
      }),
    ),
    query: emailQuery,
  },
  responses: { 204: { description: "Revoked" } },
});

export function registerWorldTokenRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(listTokensRoute, async (c) => {
    requireScope(c, "worlds.read");
    const query = c.req.valid("query");
    const user = await currentUser(c, query.email, query.email);
    const existing = await worldForUser(c, user.uid, c.req.param("worldId"));
    if (!existing) return notFound(c);
    const res = await listApiKeys({
      client: worldsAdminClient(c.env),
      query: { namespace: user.uid },
    });
    if (res.error)
      throw new HTTPException(502, { message: worldsApiError(res) });
    return respond(c, {
      tokens: (res.data?.keys ?? []).filter(
        (key) => key.worldId === existing.world_id,
      ),
    });
  });

  app.openapi(createTokenRoute, async (c) => {
    requireScope(c, "worlds.write");
    const query = c.req.valid("query");
    const user = await currentUser(c, query.email, query.email);
    const existing = await worldForUser(c, user.uid, c.req.param("worldId"));
    if (!existing) return notFound(c);
    const body = c.req.valid("json");
    const res = await createApiKey({
      client: worldsAdminClient(c.env),
      body: {
        namespace: user.uid,
        worldId: existing.world_id,
        name: body.name ?? "",
      },
    });
    if (res.error)
      throw new HTTPException(502, { message: worldsApiError(res) });
    return respond(c, { token: res.data }, 201);
  });

  app.openapi(deleteTokenRoute, async (c) => {
    requireScope(c, "worlds.write");
    const query = c.req.valid("query");
    const user = await currentUser(c, query.email, query.email);
    const existing = await worldForUser(c, user.uid, c.req.param("worldId"));
    if (!existing) return notFound(c);
    const res = await deleteApiKey({
      client: worldsAdminClient(c.env),
      path: { keyId: c.req.param("tokenUid") },
    });
    if (res.error && res.response?.status !== 404)
      throw new HTTPException(502, { message: worldsApiError(res) });
    return c.body(null, 204);
  });
}
