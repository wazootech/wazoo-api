import { Hono } from "hono";
import type { AppEnv } from "../env";
import { recordAdminAudit } from "../lib/audit";
import { all, db, first, id, now } from "../lib/db";
import {
  isAdmin,
  jsonBody,
  optionalString,
  requireOrgAccess,
  requireResourceId,
  requireScope,
  requireString,
  resolveOrg,
} from "../lib/http";
import {
  activeWorldCount,
  privateBetaQuota,
  quotaError,
  quotaStatus,
} from "../lib/quota";

type WorldRow = {
  uid: string;
  organization_uid?: string;
  world_id: string;
  display_name: string;
  region: string;
  state: string;
  create_time?: string;
  update_time?: string;
  delete_time?: string | null;
  expire_time?: string | null;
};

function worldResource(organizationId: string, row: WorldRow) {
  const restorable =
    row.state === "deleted" &&
    (!row.expire_time || new Date(row.expire_time).getTime() > Date.now());
  return {
    name: `organizations/${organizationId}/worlds/${row.world_id}`,
    uid: row.uid,
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

export const worlds = new Hono<AppEnv>()
  .get("/organizations/:organizationId/worlds", async (c) => {
    requireScope(c, "worlds.read");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const rows = await all<WorldRow>(
      db(c.env)
        .prepare(
          "SELECT * FROM worlds WHERE organization_uid = ? AND state != 'deleted' ORDER BY create_time DESC",
        )
        .bind(organization.uid),
    );
    return c.json({
      worlds: rows.map((row) =>
        worldResource(organization.organizationId, row),
      ),
    });
  })
  .post("/organizations/:organizationId/worlds", async (c) => {
    requireScope(c, "worlds.write");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const quota = await quotaStatus(c, organization.uid, organization.state);
    if (!isAdmin(c) && quota.state === "SUSPENDED")
      return quotaError(c, "Organization is suspended", quota);
    if (!isAdmin(c) && quota.state === "THROTTLED")
      return quotaError(
        c,
        "Organization has reached its private beta World limit",
        quota,
      );
    const body = await jsonBody(c);
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
        "INSERT INTO worlds (uid, organization_uid, world_id, display_name, region, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        world.id,
        organization.uid,
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
        targetResourceName: `organizations/${organization.organizationId}/worlds/${world.worldId}`,
      });
    }
    const apiBase = worldsApiBase(c.env);
    const res = await fetch(
      `${apiBase}/namespaces/${organization.uid}/worlds`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${c.env.WORLDS_API_ADMIN_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          worldId: world.worldId,
          displayName: world.displayName,
        }),
      },
    );
    if (!res.ok) {
      let message = `worlds-api returned ${res.status}`;
      try {
        const errBody = (await res.json()) as Record<string, unknown>;
        if (typeof errBody.error === "string") message = errBody.error;
        else if (typeof errBody.message === "string") message = errBody.message;
      } catch {
        // use default message
      }
      await database
        .prepare("DELETE FROM worlds WHERE uid = ?")
        .bind(world.id)
        .run();
      return c.json(
        {
          error: { code: "WORLD_PROVISIONING_FAILED", message },
        },
        502,
      );
    }
    const worldsApiResult = (await res.json()) as Record<string, unknown>;
    const row = await first<WorldRow>(
      database.prepare("SELECT * FROM worlds WHERE uid = ?").bind(world.id),
    );
    return c.json(
      {
        world: row ? worldResource(organization.organizationId, row) : null,
        syncReport: worldsApiResult.syncReport,
      },
      201,
    );
  })
  .get("/organizations/:organizationId/worlds/:worldId", async (c) => {
    requireScope(c, "worlds.read");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const world = await first<WorldRow>(
      db(c.env)
        .prepare(
          "SELECT * FROM worlds WHERE organization_uid = ? AND world_id = ?",
        )
        .bind(organization.uid, worldId),
    );
    if (!world) return c.notFound();
    return c.json({ world: worldResource(organization.organizationId, world) });
  })
  .patch("/organizations/:organizationId/worlds/:worldId", async (c) => {
    requireScope(c, "worlds.write");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const existing = await first<{ uid: string; organization_uid: string }>(
      db(c.env)
        .prepare(
          "SELECT * FROM worlds WHERE organization_uid = ? AND world_id = ?",
        )
        .bind(organization.uid, worldId),
    );
    if (!existing) return c.notFound();
    requireOrgAccess(c, existing.organization_uid);
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
    const row = await first<WorldRow>(
      db(c.env)
        .prepare("SELECT * FROM worlds WHERE uid = ?")
        .bind(existing.uid),
    );
    return c.json({
      world: row ? worldResource(organization.organizationId, row) : null,
    });
  })
  .delete("/organizations/:organizationId/worlds/:worldId", async (c) => {
    requireScope(c, "worlds.write");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const existing = await first<{ uid: string }>(
      db(c.env)
        .prepare(
          "SELECT * FROM worlds WHERE organization_uid = ? AND world_id = ?",
        )
        .bind(organization.uid, worldId),
    );
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
    await db(c.env)
      .prepare("DELETE FROM world_auth_tokens WHERE world_uid = ?")
      .bind(existing.uid)
      .run();
    try {
      const apiBase = worldsApiBase(c.env);
      await fetch(
        `${apiBase}/namespaces/${organization.uid}/worlds/${worldId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${c.env.WORLDS_API_ADMIN_KEY}`,
          },
        },
      );
    } catch {
      // best-effort
    }
    const row = await first<WorldRow>(
      db(c.env)
        .prepare("SELECT * FROM worlds WHERE uid = ?")
        .bind(existing.uid),
    );
    return c.json({
      world: row ? worldResource(organization.organizationId, row) : null,
    });
  })
  .post(
    "/organizations/:organizationId/worlds/:worldId/undelete",
    async (c) => {
      requireScope(c, "worlds.write");
      const organization = await resolveOrg(c, c.req.param("organizationId"));
      const worldId = c.req.param("worldId");
      const existing = await first<{
        uid: string;
        state: string;
        expire_time: string | null;
      }>(
        db(c.env)
          .prepare(
            "SELECT * FROM worlds WHERE organization_uid = ? AND world_id = ?",
          )
          .bind(organization.uid, worldId),
      );
      if (!existing) return c.notFound();
      if (existing.state !== "deleted") {
        return c.json(
          {
            error: {
              code: "FAILED_PRECONDITION",
              message: "World is not deleted",
            },
          },
          400,
        );
      }
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
      const quota = await quotaStatus(c, organization.uid, organization.state);
      if (!isAdmin(c) && quota.state === "SUSPENDED")
        return quotaError(c, "Organization is suspended", quota);
      const activeCount = await activeWorldCount(c, organization.uid);
      if (!isAdmin(c) && activeCount >= privateBetaQuota.maxWorlds) {
        return quotaError(c, "Maximum active Worlds exceeded", {
          state: "THROTTLED",
          reason: "MAX_WORLDS_EXCEEDED",
          usagePercent: 100,
        });
      }
      if (
        isAdmin(c) &&
        (quota.state === "SUSPENDED" ||
          activeCount >= privateBetaQuota.maxWorlds)
      ) {
        await recordAdminAudit(c, {
          action: "worlds.undelete_quota_bypass",
          targetResourceName: `organizations/${organization.organizationId}/worlds/${worldId}`,
        });
      }
      const database = db(c.env);
      try {
        const apiBase = worldsApiBase(c.env);
        const res = await fetch(
          `${apiBase}/namespaces/${organization.uid}/worlds/${worldId}/undelete`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${c.env.WORLDS_API_ADMIN_KEY}`,
            },
          },
        );
        if (!res.ok) {
          let message = `worlds-api returned ${res.status}`;
          try {
            const errBody = (await res.json()) as Record<string, unknown>;
            if (typeof errBody.error === "string") message = errBody.error;
            else if (typeof errBody.message === "string")
              message = errBody.message;
          } catch {
            // use default message
          }
          throw new Error(message);
        }
        const worldsApiResult = (await res.json()) as Record<string, unknown>;
        await database
          .prepare(
            "UPDATE worlds SET state = 'active', delete_time = NULL, expire_time = NULL, update_time = ? WHERE uid = ?",
          )
          .bind(now(), existing.uid)
          .run();
        const updated = await first<WorldRow>(
          database
            .prepare("SELECT * FROM worlds WHERE uid = ?")
            .bind(existing.uid),
        );
        return c.json({
          world: updated
            ? worldResource(organization.organizationId, updated)
            : null,
          syncReport: worldsApiResult.syncReport,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "World undelete failed";
        const updated = await first<WorldRow>(
          database
            .prepare("SELECT * FROM worlds WHERE uid = ?")
            .bind(existing.uid),
        );
        return c.json(
          {
            error: { code: "WORLD_RESTORE_BLOCKED", message },
            world: updated
              ? worldResource(organization.organizationId, updated)
              : null,
            syncReport: failedSyncReport(message),
          },
          409,
        );
      }
    },
  )
  .post("/organizations/:organizationId/worlds/:worldId/sync", async (c) => {
    requireScope(c, "worlds.admin");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    if (!isAdmin(c) && organization.state !== "ACTIVE") {
      return c.json(
        {
          error: {
            code: "PERMISSION_DENIED",
            message: "Organization is not active",
          },
          syncReport: blockedSyncReport(
            "ORGANIZATION_NOT_ACTIVE",
            "Organization is not active",
          ),
        },
        403,
      );
    }
    const worldId = c.req.param("worldId");
    const existing = await first<WorldRow>(
      db(c.env)
        .prepare(
          "SELECT * FROM worlds WHERE organization_uid = ? AND world_id = ?",
        )
        .bind(organization.uid, worldId),
    );
    if (!existing) return c.notFound();
    if (existing.state === "deleted") {
      return c.json(
        {
          error: {
            code: "FAILED_PRECONDITION",
            message: "Deleted Worlds cannot be synced",
          },
          syncReport: blockedSyncReport(
            "WORLD_DELETED",
            "Deleted Worlds cannot be synced",
          ),
        },
        400,
      );
    }
    if (isAdmin(c) && organization.state !== "ACTIVE") {
      await recordAdminAudit(c, {
        action: "worlds.sync_state_bypass",
        targetResourceName: `organizations/${organization.organizationId}/worlds/${worldId}`,
      });
    }
    const database = db(c.env);
    try {
      const apiBase = worldsApiBase(c.env);
      const res = await fetch(
        `${apiBase}/namespaces/${organization.uid}/worlds/${worldId}/sync`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${c.env.WORLDS_API_ADMIN_KEY}`,
          },
        },
      );
      if (!res.ok) {
        let message = `worlds-api returned ${res.status}`;
        try {
          const errBody = (await res.json()) as Record<string, unknown>;
          if (typeof errBody.error === "string") message = errBody.error;
          else if (typeof errBody.message === "string")
            message = errBody.message;
        } catch {
          // use default message
        }
        throw new Error(message);
      }
      const worldsApiResult = (await res.json()) as Record<string, unknown>;
      await database
        .prepare(
          "UPDATE worlds SET state = CASE WHEN state IN ('failed', 'active') THEN 'active' ELSE state END, update_time = ? WHERE uid = ?",
        )
        .bind(now(), existing.uid)
        .run();
      const row = await first<WorldRow>(
        database
          .prepare("SELECT * FROM worlds WHERE uid = ?")
          .bind(existing.uid),
      );
      return c.json({
        world: row ? worldResource(organization.organizationId, row) : null,
        syncReport: worldsApiResult.syncReport,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "World sync failed";
      const row = await first<WorldRow>(
        database
          .prepare("SELECT * FROM worlds WHERE uid = ?")
          .bind(existing.uid),
      );
      return c.json(
        {
          error: { code: "WORLD_SYNC_BLOCKED", message },
          world: row ? worldResource(organization.organizationId, row) : null,
          syncReport: failedSyncReport(message),
        },
        409,
      );
    }
  });

function blockedSyncReport(code: string, message: string) {
  return {
    status: "BLOCKED",
    actions: [],
    warnings: [],
    errors: [{ code, message }],
  };
}

function failedSyncReport(message: string) {
  return {
    status: "FAILED",
    actions: [],
    warnings: [],
    errors: [{ code: "SYNC_FAILED", message }],
  };
}
