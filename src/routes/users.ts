import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { db } from "../lib/db";
import { requireScope, respond } from "../lib/http";
import { emailQuery, UserSchema } from "../lib/schemas";

const route = createRoute({
  method: "get",
  path: "/v1/users/me",
  tags: ["Users"],
  operationId: "getUserMe",
  security: [{ bearerPlatformToken: [] }],
  request: { query: emailQuery },
  responses: {
    200: {
      description: "Existing user",
      content: {
        "application/json": { schema: z.object({ user: UserSchema }) },
      },
    },
    201: {
      description: "Created user",
      content: {
        "application/json": { schema: z.object({ user: UserSchema }) },
      },
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

export function registerUsersRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(route, async (c) => {
    requireScope(c, "users.read");
    const query = c.req.valid("query");
    if (!query.email) {
      return respond(
        c,
        {
          error: {
            code: "INVALID_ARGUMENT",
            message: "email query parameter is required",
          },
        },
        400,
      );
    }
    const database = db(c.env);
    const existing = await database
      .prepare(
        "SELECT uid, email, display_name, create_time FROM users WHERE email = ?",
      )
      .bind(query.email.toLowerCase())
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
    const uid = crypto.randomUUID();
    await database
      .prepare("INSERT INTO users (uid, email) VALUES (?, ?)")
      .bind(uid, query.email.toLowerCase())
      .run();
    const row = await database
      .prepare(
        "SELECT uid, email, display_name, create_time FROM users WHERE uid = ?",
      )
      .bind(uid)
      .first<{
        uid: string;
        email: string;
        display_name: string | null;
        create_time: string;
      }>();
    return respond(
      c,
      {
        user: {
          uid: row!.uid,
          email: row!.email,
          displayName: row!.display_name,
          state: "ACTIVE",
          createTime: row!.create_time,
        },
      },
      201,
    );
  });
}
