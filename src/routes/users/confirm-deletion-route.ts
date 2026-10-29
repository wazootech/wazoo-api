import { createRoute, z } from "@hono/zod-openapi";

export const confirmDeletionRoute = createRoute({
  method: "delete",
  path: "/v1/users/me",
  tags: ["Users"],
  operationId: "deleteUserMe",
  summary: "Delete the authenticated user's account (two-step confirmation)",
  "x-mint": { metadata: { title: "Delete account" } },
  security: [{ bearerPlatformToken: [] }],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            confirmationToken: z.string(),
          }),
        },
      },
    },
  },
  responses: {
    204: { description: "Account deleted" },
    400: {
      description: "Invalid or expired confirmation token",
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({ code: z.string(), message: z.string() }),
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
