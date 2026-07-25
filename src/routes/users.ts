import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { db } from "../lib/db";
import { requireScope, respond } from "../lib/http";
import { UserSchema } from "../lib/schemas";

const route = createRoute({
  method: "get",
  path: "/v1/users/me",
  tags: ["Users"],
  operationId: "getUserMe",
  summary: "Get authenticated user",
  security: [{ bearerPlatformToken: [] }],
  responses: {
    200: {
      description: "Authenticated user",
      content: {
        "application/json": { schema: z.object({ user: UserSchema }) },
      },
    },
    404: {
      description: "User not found",
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

export function registerUsersRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(route, async (c) => {
    requireScope(c, "users.read");
    const userUid = c.var.auth.userUid;
    if (!userUid) {
      return respond(
        c,
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "No user associated with token",
          },
        },
        401,
      );
    }

    const database = db(c.env);
    const existing = await database
      .prepare(
        "SELECT uid, email, display_name, create_time FROM users WHERE uid = ?",
      )
      .bind(userUid)
      .first<{
        uid: string;
        email: string;
        display_name: string | null;
        create_time: string;
      }>();

    if (existing) {
      return respond(c, {
        user: {
          uid: existing.uid,
          email: existing.email,
          displayName: existing.display_name,
          state: "ACTIVE",
          createTime: existing.create_time,
        },
      });
    }

    return respond(
      c,
      {
        error: {
          code: "NOT_FOUND",
          message: "User not found",
        },
      },
      404,
    );
  });
}
