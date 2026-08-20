import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../env";
import { recordAdminAudit } from "../lib/audit";
import { all, db, first, id, now, type UserRef } from "../lib/db";
import { isAdmin, requireScope, resolveUser, respond } from "../lib/http";
import {
  activeWorldCount,
  privateBetaQuota,
  quotaError,
  quotaStatus,
} from "../lib/quota";
import {
  createApiKey,
  createWorld,
  deleteApiKey,
  deleteWorld,
  listApiKeys,
  undeleteWorld,
  updateWorld,
} from "@worlds/client";
import {
  worldsAdminClient,
  worldsApiError,
  worldsApiErrorDetail,
} from "../lib/worlds-client";
import {
  CreateWorldBodySchema,
  UpdateWorldBodySchema,
  WorldListSchema,
  WorldSingleSchema,
  WorldTokenListSchema,
  WorldTokenCreateRequestSchema,
  WorldTokenSingleResponseSchema,
  worldIdParam,
  emailQuery,
} from "../lib/schemas";

interface WorldRow extends Record<string, unknown> {
  uid: string;
  user_uid: string;
  world_id: string;
  display_name: string;
  region: string;
  state: string;
  worlds_api_uid: string | null;
  create_time?: string;
  update_time?: string;
  delete_time?: string | null;
  expire_time?: string | null;
}

function worldResource(row: WorldRow) {
  const restorable =
    row.state === "deleted" &&
    (!row.expire_time || new Date(row.expire_time).getTime() > Date.now());
  return {
    name: `worlds/${row.world_id}`,
    uid: row.uid,
    worldId: row.world_id,
    worldUid: row.worlds_api_uid ?? undefined,
    displayName: row.display_name,
    region: row.region,
    state: row.state.toUpperCase(),
    restorable,
    backend: "worlds-api",
    createTime: row.create_time,
    updateTime: row.update_time,
    deleteTime: row.delete_time ?? undefined,
    expireTime: row.expire_time ?? undefined,
  };
}

async function currentUser(
  c: Context<AppEnv>,
  ownerEmail?: string,
  email?: string,
): Promise<UserRef> {
  return resolveUser(c, ownerEmail ?? email ?? undefined);
}

async function worldForUser(
  c: Context<AppEnv>,
  userUid: string,
  worldId: string,
) {
  return first<WorldRow>(
    db(c.env)
      .prepare("SELECT * FROM worlds WHERE user_uid = ? AND world_id = ?")
      .bind(userUid, worldId),
  );
}

function notFound(c: Context<AppEnv>) {
  return respond(
    c,
    { error: { code: "NOT_FOUND", message: "Not found" } },
    404,
  );
}

const listRoute = createRoute({
  method: "get",
  path: "/v1/worlds",
  tags: ["Worlds"],
  operationId: "listWorlds",
  summary: "List worlds",
  "x-mint": { metadata: { title: "List worlds" } },
  security: [{ bearerPlatformToken: [] }],
  request: { query: emailQuery },
  responses: {
    200: {
      description: "World list",
      content: { "application/json": { schema: WorldListSchema } },
    },
  },
});

const createRouteDef = createRoute({
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

const getRoute = createRoute({
  method: "get",
  path: "/v1/worlds/{worldId}",
  tags: ["Worlds"],
  operationId: "getWorld",
  summary: "Get world",
  "x-mint": { metadata: { title: "Get world" } },
  security: [{ bearerPlatformToken: [] }],
  request: { params: worldIdParam, query: emailQuery },
  responses: {
    200: {
      description: "World",
      content: { "application/json": { schema: WorldSingleSchema } },
    },
    404: {
      description: "Not found",
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

const deleteRoute = createRoute({
  method: "delete",
  path: "/v1/worlds/{worldId}",
  tags: ["Worlds"],
  operationId: "deleteWorld",
  summary: "Delete world",
  "x-mint": { metadata: { title: "Delete world" } },
  security: [{ bearerPlatformToken: [] }],
  request: { params: worldIdParam, query: emailQuery },
  responses: {
    200: {
      description: "Deleted World",
      content: { "application/json": { schema: WorldSingleSchema } },
    },
    404: {
      description: "Not found",
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

const undeleteRoute = createRoute({
  method: "post",
  path: "/v1/worlds/{worldId}/undelete",
  tags: ["Worlds"],
  operationId: "undeleteWorld",
  summary: "Undelete world",
  "x-mint": { metadata: { title: "Undelete world" } },
  security: [{ bearerPlatformToken: [] }],
  request: { params: worldIdParam, query: emailQuery },
  responses: {
    200: {
      description: "Restored World",
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

const listTokensRoute = createRoute({
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

const createTokenRoute = createRoute({
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

const deleteTokenRoute = createRoute({
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

export function registerWorldsRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(listRoute, async (c) => {
    requireScope(c, "worlds.read");
    const query = c.req.valid("query");
    const user = await currentUser(c, query.email, query.email);
    const rows = await all<WorldRow>(
      db(c.env)
        .prepare(
          "SELECT * FROM worlds WHERE user_uid = ? AND state != 'deleted' ORDER BY create_time DESC",
        )
        .bind(user.uid),
    );
    return respond(c, { worlds: rows.map(worldResource) });
  });

  app.openapi(createRouteDef, async (c) => {
    requireScope(c, "worlds.write");
    const body = c.req.valid("json");
    const user = await currentUser(c, body.ownerEmail, body.email);
    const quota = await quotaStatus(c, user.uid);
    if (!isAdmin(c) && quota.state === "THROTTLED") {
      return quotaError(
        c,
        "User has reached the private beta World limit",
        quota,
      );
    }

    const database = db(c.env);

    const client = worldsAdminClient(c.env);

    // Mint a namespace-scoped worlds-api key so tenancy is derived from auth
    // (the key's namespace), never from a request body field.
    const keyRes = await createApiKey({
      client,
      body: {
        namespace: user.uid,
        name: "wazoo-api world provisioning",
      },
    });
    if (keyRes.error) {
      return respond(
        c,
        {
          error: {
            code: "WORLD_PROVISIONING_FAILED",
            message: worldsApiError(keyRes),
          },
        },
        502,
      );
    }
    const mintedKey = keyRes.data;

    const world = {
      id: `w_${id()}`,
      worldId: body.worldId,
      displayName: body.world.displayName,
      region: body.world.region,
      now: now(),
    };

    const res = await createWorld({
      client,
      auth: mintedKey.token,
      body: {
        displayName: world.displayName,
      },
    });
    if (res.error) {
      const detail = worldsApiErrorDetail(res);
      // Surface the org-wide database-plan cap as a quota-style error instead
      // of burying it in a generic provisioning failure.
      if (detail.code === "DATABASE_LIMIT_REACHED") {
        return respond(
          c,
          {
            error: { code: detail.code, message: detail.message },
            quota: {
              state: "THROTTLED",
              reason: "DATABASE_LIMIT_REACHED",
              usagePercent: 100,
            },
          },
          429,
        );
      }
      return respond(
        c,
        {
          error: {
            code: "WORLD_PROVISIONING_FAILED",
            message: detail.message,
          },
        },
        502,
      );
    }
    const createdWorld = res.data;

    await database
      .prepare(
        "INSERT INTO worlds (uid, user_uid, world_id, display_name, region, worlds_api_uid, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        world.id,
        user.uid,
        world.worldId,
        world.displayName,
        world.region,
        createdWorld.uid,
        world.now,
        world.now,
      )
      .run();

    if (isAdmin(c) && quota.state !== "OK" && quota.state !== "WARN") {
      await recordAdminAudit(c, {
        action: "worlds.create_quota_bypass",
        targetResourceName: `users/${user.uid}/worlds/${world.worldId}`,
      });
    }

    const row = await first<WorldRow>(
      database.prepare("SELECT * FROM worlds WHERE uid = ?").bind(world.id),
    );
    return respond(c, { world: row ? worldResource(row) : null }, 201);
  });

  app.openapi(getRoute, async (c) => {
    requireScope(c, "worlds.read");
    const query = c.req.valid("query");
    const user = await currentUser(c, query.email, query.email);
    const world = await worldForUser(c, user.uid, c.req.param("worldId"));
    if (!world) return notFound(c);
    return respond(c, { world: worldResource(world) });
  });

  app.openapi(updateRoute, async (c) => {
    requireScope(c, "worlds.write");
    const query = c.req.valid("query");
    const user = await currentUser(c, query.email, query.email);
    const existing = await worldForUser(c, user.uid, c.req.param("worldId"));
    if (!existing) return notFound(c);

    const body = c.req.valid("json");
    const updateMask = body.updateMask
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean);
    const allowed = new Set(["displayName", "region", "state"]);
    if (updateMask.some((field) => !allowed.has(field))) {
      return respond(
        c,
        {
          error: {
            code: "INVALID_ARGUMENT",
            message: "updateMask contains unknown fields",
          },
        },
        400,
      );
    }
    const patch = body.world;
    const nextState = updateMask.includes("state")
      ? (patch.state?.toUpperCase() ?? null)
      : null;
    if (nextState && nextState !== "ACTIVE" && nextState !== "SUSPENDED") {
      return respond(
        c,
        {
          error: {
            code: "INVALID_ARGUMENT",
            message: "state can only be patched to ACTIVE or SUSPENDED",
          },
        },
        400,
      );
    }

    await db(c.env)
      .prepare(
        "UPDATE worlds SET display_name = COALESCE(?, display_name), region = COALESCE(?, region), state = COALESCE(?, state), update_time = ? WHERE uid = ?",
      )
      .bind(
        updateMask.includes("displayName") ? (patch.displayName ?? null) : null,
        updateMask.includes("region") ? (patch.region ?? null) : null,
        nextState?.toLowerCase() ?? null,
        now(),
        existing.uid,
      )
      .run();

    if (updateMask.includes("displayName") && patch.displayName) {
      if (existing.worlds_api_uid) {
        const res = await updateWorld({
          client: worldsAdminClient(c.env),
          path: { id: existing.worlds_api_uid },
          body: { displayName: patch.displayName },
        });
        if (res.error) {
          return respond(
            c,
            {
              error: {
                code: "WORLD_UPDATE_FAILED",
                message: worldsApiError(res),
              },
            },
            502,
          );
        }
      }
    }

    const row = await first<WorldRow>(
      db(c.env)
        .prepare("SELECT * FROM worlds WHERE uid = ?")
        .bind(existing.uid),
    );
    return respond(c, { world: row ? worldResource(row) : null });
  });

  app.openapi(deleteRoute, async (c) => {
    requireScope(c, "worlds.write");
    const query = c.req.valid("query");
    const user = await currentUser(c, query.email, query.email);
    const worldId = c.req.param("worldId");
    const existing = await worldForUser(c, user.uid, worldId);
    if (!existing) return notFound(c);

    if (existing.worlds_api_uid) {
      const res = await deleteWorld({
        client: worldsAdminClient(c.env),
        path: { id: existing.worlds_api_uid },
      });
      if (res.error && res.response?.status !== 404) {
        return respond(
          c,
          {
            error: {
              code: "WORLD_DELETE_FAILED",
              message: worldsApiError(res),
            },
          },
          502,
        );
      }
    }

    const deletedAt = now();
    const expireAt = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await db(c.env)
      .prepare(
        "UPDATE worlds SET state = 'deleted', purge_status = 'pending', delete_time = ?, expire_time = ?, update_time = ? WHERE uid = ?",
      )
      .bind(deletedAt, expireAt, deletedAt, existing.uid)
      .run();
    const row = await first<WorldRow>(
      db(c.env)
        .prepare("SELECT * FROM worlds WHERE uid = ?")
        .bind(existing.uid),
    );
    return respond(c, { world: row ? worldResource(row) : null });
  });

  app.openapi(undeleteRoute, async (c) => {
    requireScope(c, "worlds.write");
    const query = c.req.valid("query");
    const user = await currentUser(c, query.email, query.email);
    const worldId = c.req.param("worldId");
    const existing = await worldForUser(c, user.uid, worldId);
    if (!existing) return notFound(c);
    if (existing.state !== "deleted")
      return respond(
        c,
        {
          error: {
            code: "FAILED_PRECONDITION",
            message: "World is not deleted",
          },
        },
        400,
      );
    if (
      existing.expire_time &&
      new Date(existing.expire_time).getTime() <= Date.now()
    ) {
      return respond(
        c,
        {
          error: {
            code: "WORLD_RESTORE_EXPIRED",
            message: "World undelete window has expired",
          },
        },
        400,
      );
    }
    const activeCount = await activeWorldCount(c, user.uid);
    if (!isAdmin(c) && activeCount >= privateBetaQuota.maxWorlds) {
      return quotaError(c, "Maximum active Worlds exceeded", {
        state: "THROTTLED",
        reason: "MAX_WORLDS_EXCEEDED",
        usagePercent: 100,
      });
    }
    if (existing.worlds_api_uid) {
      const res = await undeleteWorld({
        client: worldsAdminClient(c.env),
        path: { id: existing.worlds_api_uid },
      });
      if (res.error) {
        return respond(
          c,
          {
            error: {
              code: "WORLD_UNDELETE_FAILED",
              message: worldsApiError(res),
            },
          },
          502,
        );
      }
    }

    await db(c.env)
      .prepare(
        "UPDATE worlds SET state = 'active', delete_time = NULL, expire_time = NULL, update_time = ? WHERE uid = ?",
      )
      .bind(now(), existing.uid)
      .run();
    const row = await first<WorldRow>(
      db(c.env)
        .prepare("SELECT * FROM worlds WHERE uid = ?")
        .bind(existing.uid),
    );
    return respond(c, { world: row ? worldResource(row) : null });
  });

  app.openapi(listTokensRoute, async (c) => {
    requireScope(c, "worlds.read");
    const query = c.req.valid("query");
    const user = await currentUser(c, query.email, query.email);
    const existing = await worldForUser(c, user.uid, c.req.param("worldId"));
    if (!existing) return notFound(c);
    const res = await listApiKeys({
      client: worldsAdminClient(c.env),
      query: { namespace: user.uid },
    });
    if (res.error)
      throw new HTTPException(502, { message: worldsApiError(res) });
    return respond(c, {
      tokens: (res.data?.keys ?? []).filter(
        (key) => key.worldId === existing.worlds_api_uid,
      ),
    });
  });

  app.openapi(createTokenRoute, async (c) => {
    requireScope(c, "worlds.write");
    const query = c.req.valid("query");
    const user = await currentUser(c, query.email, query.email);
    const existing = await worldForUser(c, user.uid, c.req.param("worldId"));
    if (!existing) return notFound(c);
    const body = c.req.valid("json");
    const res = await createApiKey({
      client: worldsAdminClient(c.env),
      body: {
        namespace: user.uid,
        worldId: existing.worlds_api_uid ?? undefined,
        name: body.name ?? "",
      },
    });
    if (res.error)
      throw new HTTPException(502, { message: worldsApiError(res) });
    return respond(c, { token: res.data }, 201);
  });

  app.openapi(deleteTokenRoute, async (c) => {
    requireScope(c, "worlds.write");
    const query = c.req.valid("query");
    const user = await currentUser(c, query.email, query.email);
    const existing = await worldForUser(c, user.uid, c.req.param("worldId"));
    if (!existing) return notFound(c);
    const res = await deleteApiKey({
      client: worldsAdminClient(c.env),
      path: { keyId: c.req.param("tokenUid") },
    });
    if (res.error && res.response?.status !== 404)
      throw new HTTPException(502, { message: worldsApiError(res) });
    return c.body(null, 204) as any;
  });
}
