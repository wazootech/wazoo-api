import { createRoute } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";
import {
  UpdateWorldBodySchema,
  WorldSingleSchema,
  worldIdParam,
  emailQuery,
} from "../../lib/schemas";

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

export { updateRoute };
