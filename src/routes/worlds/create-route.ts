import { createRoute, z } from "@hono/zod-openapi";
import {
  CreateWorldBodySchema,
  ErrorResponseSchema,
  WorldSingleSchema,
} from "../../lib/schemas";

export const createRouteDef = createRoute({
  method: "post",
  path: "/v1/worlds",
  tags: ["Worlds"],
  operationId: "createWorld",
  summary: "Create world",
  "x-mint": { metadata: { title: "Create world" } },
  security: [{ bearerPlatformToken: [] }],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: CreateWorldBodySchema } },
    },
  },
  responses: {
    201: {
      description: "Created World",
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
    409: {
      description: "World ID already exists",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    502: {
      description: "World provisioning failed",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },

    429: {
      description: "Quota exceeded",
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({ code: z.string(), message: z.string() }),
            quota: z.object({
              state: z.string(),
              reason: z.string().optional(),
              usagePercent: z.number().optional(),
            }),
          }),
        },
      },
    },
  },
});
