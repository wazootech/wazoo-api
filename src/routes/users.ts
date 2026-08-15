import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";
import type { AppEnv } from "../env";
import { createToken, sha256Hex } from "../lib/crypto";
import { db, id, now } from "../lib/db";
import { isAdmin, requireScope, respond } from "../lib/http";
import { UserSchema } from "../lib/schemas";

const DELETION_TOKEN_TTL_MS = 15 * 60 * 1000;

const route = createRoute({
  method: "get",
  path: "/v1/users/me",
  tags: ["Users"],
  operationId: "getUserMe",
  summary: "Get authenticated user",
  "x-mint": { metadata: { title: "Get authenticated user" } },
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

const initiateDeletionRoute = createRoute({
  method: "post",
  path: "/v1/users/me/deletion",
  tags: ["Users"],
  operationId: "initiateAccountDeletion",
  summary: "Initiate account deletion (returns a short-lived confirmation token)",
  "x-mint": { metadata: { title: "Initiate account deletion" } },
  security: [{ bearerPlatformToken: [] }],
  responses: {
    201: {
      description: "Deletion initiated",
      content: {
        "application/json": {
          schema: z.object({
            deletion: z.object({
              uid: z.string(),
              expiresAt: z.string(),
            }),
            message: z.string(),
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

const confirmDeletionRoute = createRoute({
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

const exportRoute = createRoute({
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
                uid: z.string(),
                worldId: z.string(),
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

interface UserRow extends Record<string, unknown> {
  uid: string;
  email: string;
  display_name: string | null;
  state: string;
  create_time: string;
}

function userResource(row: UserRow) {
  return {
    uid: row.uid,
    email: row.email,
    displayName: row.display_name,
    state: "ACTIVE",
    createTime: row.create_time,
  };
}

function worldsApiBase(env: AppEnv["Bindings"]) {
  return env.WORLDS_API_URL.replace(/\/+$/, "");
}

/** Ensures the token belongs to a user (not an env/admin token) and returns it. */
function requireUserToken(c: Context<AppEnv>): { userUid: string } {
  const auth = c.get("auth");
  if (isAdmin(c) || !auth.userUid) {
    throw new HTTPException(401, {
      message: "Account deletion and data export require a user token",
    });
  }
  return { userUid: auth.userUid };
}

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

  app.openapi(initiateDeletionRoute, async (c) => {
    requireScope(c, "users.write");
    const { userUid } = requireUserToken(c);

    const database = db(c.env);
    const existing = await database
      .prepare("SELECT uid FROM users WHERE uid = ? AND state = 'active'")
      .bind(userUid)
      .first<{ uid: string }>();
    if (!existing) {
      return respond(
        c,
        { error: { code: "NOT_FOUND", message: "User not found" } },
        404,
      );
    }

    // Invalidate any prior pending request for this user (one active token).
    await database
      .prepare("DELETE FROM deletion_requests WHERE user_uid = ?")
      .bind(userUid)
      .run();

    const requestUid = id();
    const token = createToken("wzdel");
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + DELETION_TOKEN_TTL_MS).toISOString();
    await database
      .prepare(
        "INSERT INTO deletion_requests (uid, user_uid, token_hash, expires_at) VALUES (?, ?, ?, ?)",
      )
      .bind(requestUid, userUid, tokenHash, expiresAt)
      .run();

    return respond(
      c,
      {
        deletion: { uid: requestUid, expiresAt },
        message:
          "Account deletion requested. Confirm within 15 minutes to permanently delete the account and its data.",
      },
      201,
    );
  });

  app.openapi(confirmDeletionRoute, async (c) => {
    requireScope(c, "users.write");
    const { userUid } = requireUserToken(c);
    const body = c.req.valid("json");
    const database = db(c.env);

    const tokenHash = await sha256Hex(body.confirmationToken);
    const pending = await database
      .prepare(
        "SELECT uid, expires_at FROM deletion_requests WHERE user_uid = ? AND token_hash = ?",
      )
      .bind(userUid, tokenHash)
      .first<{ uid: string; expires_at: string }>();

    if (!pending) {
      return respond(
        c,
        {
          error: {
            code: "INVALID_ARGUMENT",
            message: "Invalid confirmation token",
          },
        },
        400,
      );
    }
    if (new Date(pending.expires_at).getTime() <= Date.now()) {
      await database
        .prepare("DELETE FROM deletion_requests WHERE uid = ?")
        .bind(pending.uid)
        .run();
      return respond(
        c,
        {
          error: {
            code: "INVALID_ARGUMENT",
            message: "Confirmation token expired. Start deletion again.",
          },
        },
        400,
      );
    }

    // Mark every world for this user (namespace) deleted in worlds-api so the
    // purge sweep destroys the underlying databases after the grace period.
    const worldsRes = await fetch(
      `${worldsApiBase(c.env)}/admin/namespaces/${encodeURIComponent(userUid)}/delete`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${c.env.WORLDS_API_ADMIN_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );
    if (!worldsRes.ok) {
      return respond(
        c,
        {
          error: {
            code: "WORLD_DELETE_FAILED",
            message: "Could not mark worlds for deletion. Please try again.",
          },
        },
        502,
      );
    }

    // Hard-delete the user. FK cascades remove their worlds mirror rows
    // (worlds.user_uid), platform tokens (platform_api_tokens.user_uid), and
    // usage events (usage_events.user_uid); the per-world databases themselves
    // are destroyed by worlds-api's purge sweep after the grace period.
    await database
      .prepare("DELETE FROM users WHERE uid = ?")
      .bind(userUid)
      .run();

    return c.body(null, 204) as any;
  });

  app.openapi(exportRoute, async (c) => {
    requireScope(c, "users.read");
    const { userUid } = requireUserToken(c);
    const database = db(c.env);

    const user = await database
      .prepare(
        "SELECT uid, email, display_name, create_time FROM users WHERE uid = ?",
      )
      .bind(userUid)
      .first<UserRow>();
    if (!user) {
      return respond(
        c,
        { error: { code: "NOT_FOUND", message: "User not found" } },
        404,
      );
    }

    const worlds = await database
      .prepare(
        "SELECT uid, world_id, display_name, state, create_time, delete_time FROM worlds WHERE user_uid = ?",
      )
      .bind(userUid)
      .all<{
        uid: string;
        world_id: string;
        display_name: string;
        state: string;
        create_time: string;
        delete_time: string | null;
      }>();

    const apiTokens = await database
      .prepare(
        "SELECT uid, name, scope, create_time FROM platform_api_tokens WHERE user_uid = ? AND kind != 'ADMIN'",
      )
      .bind(userUid)
      .all<{
        uid: string;
        name: string;
        scope: string;
        create_time: string;
      }>();

    const usageEvents = await database
      .prepare(
        "SELECT metric, quantity, unit, create_time FROM usage_events WHERE user_uid = ?",
      )
      .bind(userUid)
      .all<{
        metric: string;
        quantity: number;
        unit: string;
        create_time: string;
      }>();

    return respond(c, {
      user: userResource(user),
      worlds: (worlds.results ?? []).map((w) => ({
        uid: w.uid,
        worldId: w.world_id,
        displayName: w.display_name,
        state: w.state,
        createTime: w.create_time,
        deleteTime: w.delete_time,
      })),
      apiTokens: (apiTokens.results ?? []).map((t) => ({
        uid: t.uid,
        name: t.name,
        scope: t.scope,
        createTime: t.create_time,
      })),
      usageEvents: (usageEvents.results ?? []).map((e) => ({
        metric: e.metric,
        quantity: e.quantity,
        unit: e.unit,
        createTime: e.create_time,
      })),
    });
  });
}
