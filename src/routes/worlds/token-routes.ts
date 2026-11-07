import { createRoute, z } from "@hono/zod-openapi";
import {
  WorldTokenListSchema,
  WorldTokenCreateRequestSchema,
  WorldTokenSingleResponseSchema,
  worldIdParam,
  emailQuery,
} from "../../lib/schemas";

export const listTokensRoute = createRoute({
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

export const createTokenRoute = createRoute({
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

export const deleteTokenRoute = createRoute({
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
