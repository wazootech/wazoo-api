import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { db, id, now } from "../lib/db";
import { isAdmin, requireScope, respond } from "../lib/http";
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
    const email = c.req.query("email");
    const auth = c.var.auth;

    if (!auth.userUid && !(isAdmin(c) && email)) {
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
    const identifier = auth.userUid ?? email;
    const existing = await database
      .prepare(
        "SELECT uid, email, display_name, create_time FROM users WHERE uid = ? OR email = ?",
      )
      .bind(identifier, identifier?.toLowerCase())
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

    if (isAdmin(c) && email) {
      const uid = id();
      const createTime = now();
      const displayName = email.split("@")[0];
      await database
        .prepare(
          "INSERT INTO users (uid, email, display_name, state, create_time) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(uid, email.toLowerCase(), displayName, "active", createTime)
        .run();
      return respond(
        c,
        {
          user: {
            uid,
            email,
            displayName,
            state: "ACTIVE",
            createTime,
          },
        },
        201,
      );
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
