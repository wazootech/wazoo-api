import { Hono } from "hono";
import type { AppEnv } from "../env";
import { all, db, first, id, now } from "../lib/db";
import { isAdmin, jsonBody, optionalString, requireOrgAccess, requireResourceId, requireScope, requireString, resolveOrg } from "../lib/http";
import { provisionWorldDatabase, WORLD_SCHEMA_VERSION } from "../lib/provisioning";
import { activeWorldCount, privateBetaQuota, quotaError, quotaStatus } from "../lib/quota";
import { recordUsage } from "../lib/usage";

type WorldRow = { uid: string; organization_uid?: string; world_id: string; display_name: string; region: string; state: string; provisioning_state?: string; provisioning_error?: string | null; turso_database_name?: string | null; turso_database_url?: string | null; schema_version?: string | null; durability_state?: string; durability_error?: string | null; create_time?: string; update_time?: string; delete_time?: string | null; expire_time?: string | null };

function worldResource(organizationId: string, row: WorldRow) {
  const restorable = row.state === "deleted" && (!row.expire_time || new Date(row.expire_time).getTime() > Date.now());
  return {
    name: `organizations/${organizationId}/worlds/${row.world_id}`,
    uid: row.uid,
    displayName: row.display_name,
    region: row.region,
    state: row.state.toUpperCase(),
    restorable,
    storage: { backend: "TURSO", schemaVersion: row.schema_version ?? undefined },
    provisioning: { state: (row.provisioning_state ?? "pending").toUpperCase(), error: row.provisioning_error ?? undefined },
    durability: { backend: "R2", state: (row.durability_state ?? "not_configured").toUpperCase(), error: row.durability_error ?? undefined },
    createTime: row.create_time,
    updateTime: row.update_time,
    deleteTime: row.delete_time ?? undefined,
    expireTime: row.expire_time ?? undefined
  };
}

export const worlds = new Hono<AppEnv>()
  .get("/organizations/:organizationId/worlds", async (c) => {
    requireScope(c, "worlds.read");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const rows = await all<WorldRow>(db(c.env).prepare("SELECT * FROM worlds WHERE organization_uid = ? AND state != 'deleted' ORDER BY create_time DESC").bind(organization.uid));
    return c.json({ worlds: rows.map((row) => worldResource(organization.organizationId, row)) });
  })
  .post("/organizations/:organizationId/worlds", async (c) => {
    requireScope(c, "worlds.write");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const quota = await quotaStatus(c, organization.uid, organization.state);
    if (!isAdmin(c) && quota.state === "SUSPENDED") return quotaError(c, "Organization is suspended", quota);
    if (!isAdmin(c) && quota.state === "THROTTLED") return quotaError(c, "Organization has reached its private beta World limit", quota);
    const body = await jsonBody(c);
    const worldBody = body.world;
    if (!worldBody || typeof worldBody !== "object" || Array.isArray(worldBody)) {
      return c.json({ error: { code: "INVALID_ARGUMENT", message: "world is required" } }, 400);
    }
    const world = {
      id: `w_${id()}`,
      worldId: requireResourceId(body, "worldId"),
      displayName: requireString(worldBody as Record<string, unknown>, "displayName"),
      region: optionalString(worldBody as Record<string, unknown>, "region") ?? "auto",
      now: now()
    };
    const database = db(c.env);
    await database.prepare(
      "INSERT INTO worlds (uid, organization_uid, world_id, display_name, region, provisioning_state, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(world.id, organization.uid, world.worldId, world.displayName, world.region, "pending", world.now, world.now)
      .run();
    try {
      const provisioned = await provisionWorldDatabase(c.env, world.id, organization.uid);
      await database.prepare("UPDATE worlds SET state = 'active', provisioning_state = 'active', provisioning_error = NULL, turso_database_name = ?, turso_database_url = ?, schema_version = ?, durability_state = 'configured', update_time = ? WHERE uid = ?")
        .bind(provisioned.databaseName, provisioned.databaseUrl, WORLD_SCHEMA_VERSION, now(), world.id)
        .run();
      await recordUsage(c.env, { organizationUid: organization.uid, worldUid: world.id, metric: "world.create.count" });
      await recordUsage(c.env, { organizationUid: organization.uid, worldUid: world.id, metric: "world.provision.count" });
      const row = await first<WorldRow>(database.prepare("SELECT * FROM worlds WHERE uid = ?").bind(world.id));
      return c.json({ world: row ? worldResource(organization.organizationId, row) : null, syncReport: provisioned.syncReport }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "World provisioning failed";
      await database.prepare("UPDATE worlds SET state = 'failed', provisioning_state = 'failed', provisioning_error = ?, update_time = ? WHERE uid = ?")
        .bind(message, now(), world.id)
        .run();
      const row = await first<WorldRow>(database.prepare("SELECT * FROM worlds WHERE uid = ?").bind(world.id));
      return c.json({ error: { code: "WORLD_PROVISIONING_FAILED", message }, world: row ? worldResource(organization.organizationId, row) : null }, 502);
    }
  })
  .get("/organizations/:organizationId/worlds/:worldId", async (c) => {
    requireScope(c, "worlds.read");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const world = await first<WorldRow>(db(c.env).prepare("SELECT * FROM worlds WHERE organization_uid = ? AND world_id = ?").bind(organization.uid, worldId));
    if (!world) return c.notFound();
    return c.json({ world: worldResource(organization.organizationId, world) });
  })
  .patch("/organizations/:organizationId/worlds/:worldId", async (c) => {
    requireScope(c, "worlds.write");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const existing = await first<{ uid: string; organization_uid: string }>(db(c.env).prepare("SELECT * FROM worlds WHERE organization_uid = ? AND world_id = ?").bind(organization.uid, worldId));
    if (!existing) return c.notFound();
    requireOrgAccess(c, existing.organization_uid);
    const body = await jsonBody(c);
    const updateMask = requireString(body, "updateMask").split(",").map((field) => field.trim()).filter(Boolean);
    const allowed = new Set(["displayName", "region", "state"]);
    if (updateMask.some((field) => !allowed.has(field))) {
      return c.json({ error: { code: "INVALID_ARGUMENT", message: "updateMask contains unknown fields" } }, 400);
    }
    const worldBody = body.world;
    if (!worldBody || typeof worldBody !== "object" || Array.isArray(worldBody)) {
      return c.json({ error: { code: "INVALID_ARGUMENT", message: "world is required" } }, 400);
    }
    const patch = worldBody as Record<string, unknown>;
    const nextState = updateMask.includes("state") ? requireString(patch, "state").toUpperCase() : null;
    if (nextState && nextState !== "ACTIVE" && nextState !== "SUSPENDED") {
      return c.json({ error: { code: "INVALID_ARGUMENT", message: "state can only be patched to ACTIVE or SUSPENDED" } }, 400);
    }
    await db(c.env).prepare("UPDATE worlds SET display_name = COALESCE(?, display_name), region = COALESCE(?, region), state = COALESCE(?, state), update_time = ? WHERE uid = ?")
      .bind(updateMask.includes("displayName") ? requireString(patch, "displayName") : null, updateMask.includes("region") ? requireString(patch, "region") : null, nextState?.toLowerCase() ?? null, now(), existing.uid)
      .run();
    const row = await first<WorldRow>(db(c.env).prepare("SELECT * FROM worlds WHERE uid = ?").bind(existing.uid));
    return c.json({ world: row ? worldResource(organization.organizationId, row) : null });
  })
  .delete("/organizations/:organizationId/worlds/:worldId", async (c) => {
    requireScope(c, "worlds.write");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const existing = await first<{ uid: string }>(db(c.env).prepare("SELECT * FROM worlds WHERE organization_uid = ? AND world_id = ?").bind(organization.uid, worldId));
    if (!existing) return c.notFound();
    const deletedAt = now();
    const expireAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await db(c.env).prepare("UPDATE worlds SET state = 'deleted', provisioning_state = 'deleted', purge_status = 'pending', delete_time = ?, expire_time = ?, update_time = ? WHERE uid = ?").bind(deletedAt, expireAt, deletedAt, existing.uid).run();
    await db(c.env).prepare("DELETE FROM world_auth_tokens WHERE world_uid = ?").bind(existing.uid).run();
    const row = await first<WorldRow>(db(c.env).prepare("SELECT * FROM worlds WHERE uid = ?").bind(existing.uid));
    return c.json({ world: row ? worldResource(organization.organizationId, row) : null });
  })
  .post("/organizations/:organizationId/worlds/:worldId\\:undelete", async (c) => {
    requireScope(c, "worlds.write");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const existing = await first<{ uid: string; state: string; expire_time: string | null }>(db(c.env).prepare("SELECT * FROM worlds WHERE organization_uid = ? AND world_id = ?").bind(organization.uid, worldId));
    if (!existing) return c.notFound();
    if (existing.state !== "deleted") {
      return c.json({ error: { code: "FAILED_PRECONDITION", message: "World is not deleted" } }, 400);
    }
    if (existing.expire_time && new Date(existing.expire_time).getTime() <= Date.now()) {
      return c.json({ error: { code: "WORLD_RESTORE_EXPIRED", message: "World undelete window has expired" } }, 400);
    }
    const activeCount = await activeWorldCount(c, organization.uid);
    if (!isAdmin(c) && activeCount >= privateBetaQuota.maxWorlds) {
      return quotaError(c, "Maximum active Worlds exceeded", { state: "THROTTLED", reason: "MAX_WORLDS_EXCEEDED", usagePercent: 100 });
    }
    const database = db(c.env);
    const row = await first<WorldRow>(database.prepare("SELECT * FROM worlds WHERE uid = ?").bind(existing.uid));
    if (!row) return c.notFound();
    try {
      const provisioned = await provisionWorldDatabase(c.env, row.uid, organization.uid);
      await database.prepare("UPDATE worlds SET state = 'active', provisioning_state = 'active', provisioning_error = NULL, turso_database_name = ?, turso_database_url = ?, schema_version = ?, durability_state = 'configured', delete_time = NULL, expire_time = NULL, update_time = ? WHERE uid = ?")
        .bind(provisioned.databaseName, provisioned.databaseUrl, WORLD_SCHEMA_VERSION, now(), existing.uid)
        .run();
      await recordUsage(c.env, { organizationUid: organization.uid, worldUid: existing.uid, metric: "world.sync.count" });
      const updated = await first<WorldRow>(database.prepare("SELECT * FROM worlds WHERE uid = ?").bind(existing.uid));
      return c.json({ world: updated ? worldResource(organization.organizationId, updated) : null, syncReport: provisioned.syncReport });
    } catch (error) {
      const message = error instanceof Error ? error.message : "World sync failed";
      await database.prepare("UPDATE worlds SET provisioning_state = 'failed', provisioning_error = ?, update_time = ? WHERE uid = ?").bind(message, now(), existing.uid).run();
      const updated = await first<WorldRow>(database.prepare("SELECT * FROM worlds WHERE uid = ?").bind(existing.uid));
      return c.json({ error: { code: "WORLD_RESTORE_BLOCKED", message }, world: updated ? worldResource(organization.organizationId, updated) : null }, 409);
    }
  })
  .post("/organizations/:organizationId/worlds/:worldId\\:sync", async (c) => {
    requireScope(c, "worlds.admin");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    if (!isAdmin(c) && organization.state !== "ACTIVE") {
      return c.json({ error: { code: "PERMISSION_DENIED", message: "Organization is not active" } }, 403);
    }
    const worldId = c.req.param("worldId");
    const existing = await first<{ uid: string; state: string }>(db(c.env).prepare("SELECT * FROM worlds WHERE organization_uid = ? AND world_id = ?").bind(organization.uid, worldId));
    if (!existing) return c.notFound();
    if (existing.state === "deleted") {
      return c.json({ error: { code: "FAILED_PRECONDITION", message: "Deleted Worlds cannot be synced" } }, 400);
    }
    const database = db(c.env);
    try {
      const provisioned = await provisionWorldDatabase(c.env, existing.uid, organization.uid);
      await database.prepare("UPDATE worlds SET state = CASE WHEN state IN ('failed', 'active') THEN 'active' ELSE state END, provisioning_state = 'active', provisioning_error = NULL, turso_database_name = ?, turso_database_url = ?, schema_version = ?, durability_state = 'configured', update_time = ? WHERE uid = ?")
        .bind(provisioned.databaseName, provisioned.databaseUrl, WORLD_SCHEMA_VERSION, now(), existing.uid)
        .run();
      await recordUsage(c.env, { organizationUid: organization.uid, worldUid: existing.uid, metric: "world.sync.count" });
      const row = await first<WorldRow>(database.prepare("SELECT * FROM worlds WHERE uid = ?").bind(existing.uid));
      return c.json({ world: row ? worldResource(organization.organizationId, row) : null, syncReport: provisioned.syncReport });
    } catch (error) {
      const message = error instanceof Error ? error.message : "World sync failed";
      await database.prepare("UPDATE worlds SET provisioning_state = 'failed', provisioning_error = ?, update_time = ? WHERE uid = ?").bind(message, now(), existing.uid).run();
      const row = await first<WorldRow>(database.prepare("SELECT * FROM worlds WHERE uid = ?").bind(existing.uid));
      return c.json({ error: { code: "WORLD_SYNC_BLOCKED", message }, world: row ? worldResource(organization.organizationId, row) : null }, 409);
    }
  });
