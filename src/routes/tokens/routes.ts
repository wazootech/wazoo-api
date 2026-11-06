import { createRoute, z } from "@hono/zod-openapi";
import {
  PlatformTokenSchema,
  PlatformTokenCreateRequestSchema,
  PlatformTokenCreateResponseSchema,
  PlatformTokenDeleteResponseSchema,
  PlatformTokenValidateResponseSchema,
  tokenNameParam,
} from "../../lib/schemas";

export const listRoute = createRoute({
  method: "get",
  path: "/v1/auth/api-tokens",
  tags: ["PlatformTokens"],
  operationId: "listPlatformTokens",
  summary: "List platform tokens",
  "x-mint": { metadata: { title: "List platform tokens" } },
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

export const createRouteDef = createRoute({
  method: "post",
  path: "/v1/auth/api-tokens",
  tags: ["PlatformTokens"],
  operationId: "createPlatformToken",
  summary: "Create platform token",
  "x-mint": { metadata: { title: "Create platform token" } },
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

export const createNamedRoute = createRoute({
  method: "post",
  path: "/v1/auth/api-tokens/{tokenName}",
  tags: ["PlatformTokens"],
  operationId: "createNamedPlatformToken",
  summary: "Create named platform token",
  "x-mint": { metadata: { title: "Create named platform token" } },
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

export const deleteRoute = createRoute({
  method: "delete",
  path: "/v1/auth/api-tokens/{tokenName}",
  tags: ["PlatformTokens"],
  operationId: "deletePlatformToken",
  summary: "Revoke platform token",
  "x-mint": { metadata: { title: "Revoke platform token" } },
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

export const validateRoute = createRoute({
  method: "get",
  path: "/v1/auth/api-tokens/validate",
  tags: ["PlatformTokens"],
  operationId: "validatePlatformToken",
  summary: "Validate platform token",
  "x-mint": { metadata: { title: "Validate platform token" } },
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
