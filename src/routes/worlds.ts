import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../env";
import { recordAdminAudit } from "../lib/audit";
import { all, db, first, id, now, type UserRef } from "../lib/db";
import {
  isAdmin,
  jsonBody,
  optionalString,
  requireResourceId,
  requireScope,
  requireString,
  resolveUser,
} from "../lib/http";
import {
  activeWorldCount,
  privateBetaQuota,
  quotaError,
  quotaStatus,
} from "../lib/quota";

type WorldRow = {
  uid: string;
  user_uid: string;
  world_id: string;
  display_name: string;
  region: string;
  state: string;
  create_time?: string;
  update_time?: string;
  delete_time?: string | null;
  expire_time?: string | null;
};

function worldResource(row: WorldRow) {
  const restorable =
    row.state === "deleted" &&
    (!row.expire_time || new Date(row.expire_time).getTime() > Date.now());
  return {
    name: `worlds/${row.world_id}`,
    uid: row.uid,
    worldId: row.world_id,
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

function worldsApiBase(env: AppEnv["Bindings"]) {
  return env.WORLDS_API_URL.replace(/\/+$/, "");
}

async function currentUser(
  c: Context<AppEnv>,
  body?: Record<string, unknown>,
): Promise<UserRef> {
  return resolveUser(
    c,
    optionalString(body ?? {}, "ownerEmail") ??
      optionalString(body ?? {}, "email") ??
      c.req.query("email") ??
      c.req.query("user") ??
      undefined,
  );
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

async function worldsApiError(res: Response) {
  let message = `worlds-api returned ${res.status}`;
  try {
    const body = (await res.json()) as Record<string, unknown>;
    const error = body.error as Record<string, unknown> | undefined;
    if (typeof error?.message === "string") message = error.message;
    else if (typeof body.message === "string") message = body.message;
    else if (typeof body.error === "string") message = body.error;
  } catch {
    // use default message
  }
  return message;
}

export const worlds = new Hono<AppEnv>()
  .get("/worlds", async (c) => {
    requireScope(c, "worlds.read");
    const user = await currentUser(c);
    const rows = await all<WorldRow>(
      db(c.env)
        .prepare(
          "SELECT * FROM worlds WHERE user_uid = ? AND state != 'deleted' ORDER BY create_time DESC",
        )
        .bind(user.uid),
    );
    return c.json({ worlds: rows.map(worldResource) });
  })
  .post("/worlds", async (c) => {
    requireScope(c, "worlds.write");
    const body = await jsonBody(c);
    const user = await currentUser(c, body);
    const quota = await quotaStatus(c, user.uid);
    if (!isAdmin(c) && quota.state === "THROTTLED") {
      return quotaError(
        c,
        "User has reached the private beta World limit",
        quota,
      );
    }

    const worldBody = body.world;
    if (
      !worldBody ||
      typeof worldBody !== "object" ||
      Array.isArray(worldBody)
    ) {
      return c.json(
        { error: { code: "INVALID_ARGUMENT", message: "world is required" } },
        400,
      );
    }

    const world = {
      id: `w_${id()}`,
      worldId: requireResourceId(body, "worldId"),
      displayName: requireString(
        worldBody as Record<string, unknown>,
        "displayName",
      ),
      region:
        optionalString(worldBody as Record<string, unknown>, "region") ??
        "auto",
      now: now(),
    };
    const database = db(c.env);
    await database
      .prepare(
        "INSERT INTO worlds (uid, user_uid, world_id, display_name, region, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        world.id,
        user.uid,
        world.worldId,
        world.displayName,
        world.region,
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

    const res = await fetch(`${worldsApiBase(c.env)}/worlds`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.env.WORLDS_API_ADMIN_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        namespace: user.uid,
        worldId: world.worldId,
        displayName: world.displayName,
      }),
    });
    if (!res.ok) {
      const message = await worldsApiError(res);
      await database
        .prepare("DELETE FROM worlds WHERE uid = ?")
        .bind(world.id)
        .run();
      return c.json(
        { error: { code: "WORLD_PROVISIONING_FAILED", message } },
        502,
      );
    }

    const row = await first<WorldRow>(
      database.prepare("SELECT * FROM worlds WHERE uid = ?").bind(world.id),
    );
    return c.json({ world: row ? worldResource(row) : null }, 201);
  })
  .get("/worlds/:worldId", async (c) => {
    requireScope(c, "worlds.read");
    const user = await currentUser(c);
    const world = await worldForUser(c, user.uid, c.req.param("worldId"));
    if (!world) return c.notFound();
    return c.json({ world: worldResource(world) });
  })
  .patch("/worlds/:worldId", async (c) => {
    requireScope(c, "worlds.write");
    const user = await currentUser(c);
    const existing = await worldForUser(c, user.uid, c.req.param("worldId"));
    if (!existing) return c.notFound();

    const body = await jsonBody(c);
    const updateMask = requireString(body, "updateMask")
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean);
    const allowed = new Set(["displayName", "region", "state"]);
    if (updateMask.some((field) => !allowed.has(field))) {
      return c.json(
        {
          error: {
            code: "INVALID_ARGUMENT",
            message: "updateMask contains unknown fields",
          },
        },
        400,
      );
    }
    const worldBody = body.world;
    if (
      !worldBody ||
      typeof worldBody !== "object" ||
      Array.isArray(worldBody)
    ) {
      return c.json(
        { error: { code: "INVALID_ARGUMENT", message: "world is required" } },
        400,
      );
    }
    const patch = worldBody as Record<string, unknown>;
    const nextState = updateMask.includes("state")
      ? requireString(patch, "state").toUpperCase()
      : null;
    if (nextState && nextState !== "ACTIVE" && nextState !== "SUSPENDED") {
      return c.json(
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
        updateMask.includes("displayName")
          ? requireString(patch, "displayName")
          : null,
        updateMask.includes("region") ? requireString(patch, "region") : null,
        nextState?.toLowerCase() ?? null,
        now(),
        existing.uid,
      )
      .run();

    if (updateMask.includes("displayName")) {
      await fetch(`${worldsApiBase(c.env)}/worlds/${existing.world_id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${c.env.WORLDS_API_ADMIN_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          namespace: user.uid,
          displayName: requireString(patch, "displayName"),
        }),
      }).catch(() => undefined);
    }

    const row = await first<WorldRow>(
      db(c.env)
        .prepare("SELECT * FROM worlds WHERE uid = ?")
        .bind(existing.uid),
    );
    return c.json({ world: row ? worldResource(row) : null });
  })
  .delete("/worlds/:worldId", async (c) => {
    requireScope(c, "worlds.write");
    const user = await currentUser(c);
    const worldId = c.req.param("worldId");
    const existing = await worldForUser(c, user.uid, worldId);
    if (!existing) return c.notFound();
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
    await fetch(
      `${worldsApiBase(c.env)}/worlds/${worldId}?namespace=${encodeURIComponent(user.uid)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${c.env.WORLDS_API_ADMIN_KEY}` },
      },
    ).catch(() => undefined);
    const row = await first<WorldRow>(
      db(c.env)
        .prepare("SELECT * FROM worlds WHERE uid = ?")
        .bind(existing.uid),
    );
    return c.json({ world: row ? worldResource(row) : null });
  })
  .post("/worlds/:worldId/undelete", async (c) => {
    requireScope(c, "worlds.write");
    const user = await currentUser(c);
    const worldId = c.req.param("worldId");
    const existing = await worldForUser(c, user.uid, worldId);
    if (!existing) return c.notFound();
    if (existing.state !== "deleted")
      return c.json(
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
      return c.json(
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
    await db(c.env)
      .prepare(
        "UPDATE worlds SET state = 'active', delete_time = NULL, expire_time = NULL, update_time = ? WHERE uid = ?",
      )
      .bind(now(), existing.uid)
      .run();
    await fetch(`${worldsApiBase(c.env)}/worlds/${worldId}/undelete`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.env.WORLDS_API_ADMIN_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ namespace: user.uid }),
    }).catch(() => undefined);
    const row = await first<WorldRow>(
      db(c.env)
        .prepare("SELECT * FROM worlds WHERE uid = ?")
        .bind(existing.uid),
    );
    return c.json({ world: row ? worldResource(row) : null });
  })
  .post("/worlds/:worldId/sync", async (c) => {
    requireScope(c, "worlds.admin");
    const user = await currentUser(c);
    const existing = await worldForUser(c, user.uid, c.req.param("worldId"));
    if (!existing) return c.notFound();
    return c.json({
      world: worldResource(existing),
      syncReport: { status: "OK", actions: [], warnings: [], errors: [] },
    });
  })
  .get("/worlds/:worldId/auth/tokens", async (c) => {
    requireScope(c, "worlds.read");
    const user = await currentUser(c);
    const existing = await worldForUser(c, user.uid, c.req.param("worldId"));
    if (!existing) return c.notFound();
    const res = await fetch(
      `${worldsApiBase(c.env)}/api-keys?namespace=${encodeURIComponent(user.uid)}`,
      {
        headers: { Authorization: `Bearer ${c.env.WORLDS_API_ADMIN_KEY}` },
      },
    );
    if (!res.ok)
      throw new HTTPException(502, { message: await worldsApiError(res) });
    const body = (await res.json()) as {
      keys?: Array<Record<string, unknown>>;
    };
    return c.json({
      tokens: (body.keys ?? []).filter(
        (key) => key.worldId === existing.world_id,
      ),
    });
  })
  .post("/worlds/:worldId/auth/tokens", async (c) => {
    requireScope(c, "worlds.write");
    const user = await currentUser(c);
    const existing = await worldForUser(c, user.uid, c.req.param("worldId"));
    if (!existing) return c.notFound();
    const body = await jsonBody(c).catch(() => ({}));
    const res = await fetch(`${worldsApiBase(c.env)}/api-keys`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.env.WORLDS_API_ADMIN_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        namespace: user.uid,
        worldId: existing.world_id,
        name: optionalString(body, "name") ?? "",
      }),
    });
    if (!res.ok)
      throw new HTTPException(502, { message: await worldsApiError(res) });
    return c.json({ token: await res.json() }, 201);
  })
  .delete("/worlds/:worldId/auth/tokens/:tokenUid", async (c) => {
    requireScope(c, "worlds.write");
    const user = await currentUser(c);
    const existing = await worldForUser(c, user.uid, c.req.param("worldId"));
    if (!existing) return c.notFound();
    const res = await fetch(
      `${worldsApiBase(c.env)}/api-keys/${c.req.param("tokenUid")}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${c.env.WORLDS_API_ADMIN_KEY}` },
      },
    );
    if (!res.ok && res.status !== 404)
      throw new HTTPException(502, { message: await worldsApiError(res) });
    return c.body(null, 204);
  });
