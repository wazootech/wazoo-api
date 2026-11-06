import { createRoute, z } from "@hono/zod-openapi";
import { UserSchema } from "../../lib/schemas";

export const exportRoute = createRoute({
  method: "get",
  path: "/v1/users/me/export",
  tags: ["Users"],
  operationId: "exportUserMe",
  summary: "Export the data Wazoo holds on the authenticated user",
  "x-mint": { metadata: { title: "Export user data" } },
  security: [{ bearerPlatformToken: [] }],
  responses: {
    200: {
      description: "User data export",
      content: {
        "application/json": {
          schema: z.object({
            user: UserSchema,
            worlds: z.array(
              z.object({
                id: z.string(),
                displayName: z.string(),
                state: z.string(),
                createTime: z.string().optional(),
                deleteTime: z.string().nullable().optional(),
              }),
            ),
            apiTokens: z.array(
              z.object({
                uid: z.string(),
                name: z.string(),
                scope: z.string(),
                createTime: z.string().optional(),
              }),
            ),
            usageEvents: z.array(
              z.object({
                metric: z.string(),
                quantity: z.number(),
                unit: z.string(),
                createTime: z.string(),
              }),
            ),
          }),
        },
      },
    },
    401: {
      description: "Not authenticated as a user",
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
