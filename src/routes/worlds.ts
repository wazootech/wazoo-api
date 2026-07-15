import { Hono } from "hono";
import type { AppEnv } from "../env";
import { all, db, first, id, now } from "../lib/db";
import { jsonBody, optionalString, requireOrgAccess, requireResourceId, requireScope, requireString, resolveOrg } from "../lib/http";
import { provisionWorldDatabase, WORLD_SCHEMA_VERSION } from "../lib/provisioning";
import { activeWorldCount, privateBetaQuota, quotaError, quotaStatus } from "../lib/quota";
import { recordUsage } from "../lib/usage";

type WorldRow = { id: string; organization_id?: string; slug: string; name: string; region: string; status: string; provisioning_status?: string; provisioning_error?: string | null; turso_database_name?: string | null; turso_database_url?: string | null; schema_version?: string | null; durability_status?: string; durability_error?: string | null; created_at?: string; updated_at?: string; deleted_at?: string | null; expire_at?: string | null };

function worldResource(organizationId: string, row: WorldRow) {
  const restorable = row.status === "deleted" && (!row.expire_at || new Date(row.expire_at).getTime() > Date.now());
  return {
    name: `organizations/${organizationId}/worlds/${row.slug}`,
    uid: row.id,
    displayName: row.name,
    region: row.region,
    state: row.status.toUpperCase(),
    restorable,
    storage: { backend: "TURSO", schemaVersion: row.schema_version ?? undefined },
    provisioning: { state: (row.provisioning_status ?? "pending").toUpperCase(), error: row.provisioning_error ?? undefined },
    durability: { backend: "R2", state: (row.durability_status ?? "not_configured").toUpperCase(), error: row.durability_error ?? undefined },
    createTime: row.created_at,
    updateTime: row.updated_at,
    deleteTime: row.deleted_at ?? undefined,
    expireTime: row.expire_at ?? undefined
  };
}

export const worlds = new Hono<AppEnv>()
  .get("/organizations/:organizationId/worlds", async (c) => {
    requireScope(c, "worlds.read");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const rows = await all<WorldRow>(db(c.env).prepare("SELECT * FROM worlds WHERE organization_id = ? AND status != 'deleted' ORDER BY created_at DESC").bind(organization.id));
    return c.json({ worlds: rows.map((row) => worldResource(organization.slug, row)) });
  })
  .post("/organizations/:organizationId/worlds", async (c) => {
    requireScope(c, "worlds.write");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const quota = await quotaStatus(c, organization.id, organization.state);
    if (quota.state === "SUSPENDED") return quotaError(c, "Organization is suspended", quota);
    if (quota.state === "THROTTLED") return quotaError(c, "Organization has reached its private beta World limit", quota);
    const body = await jsonBody(c);
    const worldBody = body.world;
    if (!worldBody || typeof worldBody !== "object" || Array.isArray(worldBody)) {
      return c.json({ error: { code: "INVALID_ARGUMENT", message: "world is required" } }, 400);
    }
    const world = {
      id: `w_${id()}`,
      slug: requireResourceId(body, "worldId"),
      name: requireString(worldBody as Record<string, unknown>, "displayName"),
      region: optionalString(worldBody as Record<string, unknown>, "region") ?? "auto",
      now: now()
    };
    const database = db(c.env);
    await database.prepare(
      "INSERT INTO worlds (id, organization_id, slug, name, region, provisioning_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(world.id, organization.id, world.slug, world.name, world.region, "pending", world.now, world.now)
      .run();
    try {
      const provisioned = await provisionWorldDatabase(c.env, world.id, organization.id);
      await database.prepare("UPDATE worlds SET status = 'active', provisioning_status = 'active', provisioning_error = NULL, turso_database_name = ?, turso_database_url = ?, schema_version = ?, durability_status = 'configured', updated_at = ? WHERE id = ?")
        .bind(provisioned.databaseName, provisioned.databaseUrl, WORLD_SCHEMA_VERSION, now(), world.id)
        .run();
      await recordUsage(c.env, { organizationId: organization.id, worldId: world.id, metric: "world.create.count" });
      await recordUsage(c.env, { organizationId: organization.id, worldId: world.id, metric: "world.provision.count" });
      const row = await first<WorldRow>(database.prepare("SELECT * FROM worlds WHERE id = ?").bind(world.id));
      return c.json({ world: row ? worldResource(organization.slug, row) : null, syncReport: provisioned.syncReport }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "World provisioning failed";
      await database.prepare("UPDATE worlds SET status = 'failed', provisioning_status = 'failed', provisioning_error = ?, updated_at = ? WHERE id = ?")
        .bind(message, now(), world.id)
        .run();
      const row = await first<WorldRow>(database.prepare("SELECT * FROM worlds WHERE id = ?").bind(world.id));
      return c.json({ error: { code: "WORLD_PROVISIONING_FAILED", message }, world: row ? worldResource(organization.slug, row) : null }, 502);
    }
  })
  .get("/organizations/:organizationId/worlds/:worldId", async (c) => {
    requireScope(c, "worlds.read");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const world = await first<WorldRow>(db(c.env).prepare("SELECT * FROM worlds WHERE organization_id = ? AND slug = ?").bind(organization.id, worldId));
    if (!world) return c.notFound();
    return c.json({ world: worldResource(organization.slug, world) });
  })
  .patch("/organizations/:organizationId/worlds/:worldId", async (c) => {
    requireScope(c, "worlds.write");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const existing = await first<{ id: string; organization_id: string }>(db(c.env).prepare("SELECT * FROM worlds WHERE organization_id = ? AND slug = ?").bind(organization.id, worldId));
    if (!existing) return c.notFound();
    requireOrgAccess(c, existing.organization_id);
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
    await db(c.env).prepare("UPDATE worlds SET name = COALESCE(?, name), region = COALESCE(?, region), status = COALESCE(?, status), updated_at = ? WHERE id = ?")
      .bind(updateMask.includes("displayName") ? requireString(patch, "displayName") : null, updateMask.includes("region") ? requireString(patch, "region") : null, nextState?.toLowerCase() ?? null, now(), existing.id)
      .run();
    const row = await first<WorldRow>(db(c.env).prepare("SELECT * FROM worlds WHERE id = ?").bind(existing.id));
    return c.json({ world: row ? worldResource(organization.slug, row) : null });
  })
  .delete("/organizations/:organizationId/worlds/:worldId", async (c) => {
    requireScope(c, "worlds.write");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const existing = await first<{ id: string }>(db(c.env).prepare("SELECT * FROM worlds WHERE organization_id = ? AND slug = ?").bind(organization.id, worldId));
    if (!existing) return c.notFound();
    const deletedAt = now();
    const expireAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await db(c.env).prepare("UPDATE worlds SET status = 'deleted', provisioning_status = 'deleted', purge_status = 'pending', deleted_at = ?, expire_at = ?, updated_at = ? WHERE id = ?").bind(deletedAt, expireAt, deletedAt, existing.id).run();
    await db(c.env).prepare("DELETE FROM world_auth_tokens WHERE world_id = ?").bind(existing.id).run();
    const row = await first<WorldRow>(db(c.env).prepare("SELECT * FROM worlds WHERE id = ?").bind(existing.id));
    return c.json({ world: row ? worldResource(organization.slug, row) : null });
  })
  .post("/organizations/:organizationId/worlds/:worldId\\:undelete", async (c) => {
    requireScope(c, "worlds.write");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const existing = await first<{ id: string; status: string; expire_at: string | null }>(db(c.env).prepare("SELECT * FROM worlds WHERE organization_id = ? AND slug = ?").bind(organization.id, worldId));
    if (!existing) return c.notFound();
    if (existing.status !== "deleted") {
      return c.json({ error: { code: "FAILED_PRECONDITION", message: "World is not deleted" } }, 400);
    }
    if (existing.expire_at && new Date(existing.expire_at).getTime() <= Date.now()) {
      return c.json({ error: { code: "WORLD_RESTORE_EXPIRED", message: "World undelete window has expired" } }, 400);
    }
    const activeCount = await activeWorldCount(c, organization.id);
    if (activeCount >= privateBetaQuota.maxWorlds) {
      return quotaError(c, "Maximum active Worlds exceeded", { state: "THROTTLED", reason: "MAX_WORLDS_EXCEEDED", usagePercent: 100 });
    }
    const database = db(c.env);
    await database.prepare("UPDATE worlds SET status = 'active', provisioning_status = 'pending', deleted_at = NULL, expire_at = NULL, updated_at = ? WHERE id = ?").bind(now(), existing.id).run();
    const row = await first<WorldRow>(database.prepare("SELECT * FROM worlds WHERE id = ?").bind(existing.id));
    if (!row) return c.notFound();
    try {
      const provisioned = await provisionWorldDatabase(c.env, row.id, organization.id);
      await database.prepare("UPDATE worlds SET provisioning_status = 'active', provisioning_error = NULL, turso_database_name = ?, turso_database_url = ?, schema_version = ?, durability_status = 'configured', updated_at = ? WHERE id = ?")
        .bind(provisioned.databaseName, provisioned.databaseUrl, WORLD_SCHEMA_VERSION, now(), existing.id)
        .run();
      await recordUsage(c.env, { organizationId: organization.id, worldId: existing.id, metric: "world.sync.count" });
      const updated = await first<WorldRow>(database.prepare("SELECT * FROM worlds WHERE id = ?").bind(existing.id));
      return c.json({ world: updated ? worldResource(organization.slug, updated) : null, syncReport: provisioned.syncReport });
    } catch (error) {
      const message = error instanceof Error ? error.message : "World sync failed";
      await database.prepare("UPDATE worlds SET provisioning_status = 'failed', provisioning_error = ?, updated_at = ? WHERE id = ?").bind(message, now(), existing.id).run();
      const updated = await first<WorldRow>(database.prepare("SELECT * FROM worlds WHERE id = ?").bind(existing.id));
      return c.json({ error: { code: "WORLD_SYNC_BLOCKED", message }, world: updated ? worldResource(organization.slug, updated) : null }, 409);
    }
  })
  .post("/organizations/:organizationId/worlds/:worldId\\:sync", async (c) => {
    requireScope(c, "worlds.admin");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const existing = await first<{ id: string; status: string }>(db(c.env).prepare("SELECT * FROM worlds WHERE organization_id = ? AND slug = ?").bind(organization.id, worldId));
    if (!existing) return c.notFound();
    if (existing.status === "deleted") {
      return c.json({ error: { code: "FAILED_PRECONDITION", message: "Deleted Worlds cannot be synced" } }, 400);
    }
    const database = db(c.env);
    try {
      const provisioned = await provisionWorldDatabase(c.env, existing.id, organization.id);
      await database.prepare("UPDATE worlds SET status = CASE WHEN status IN ('failed', 'active') THEN 'active' ELSE status END, provisioning_status = 'active', provisioning_error = NULL, turso_database_name = ?, turso_database_url = ?, schema_version = ?, durability_status = 'configured', updated_at = ? WHERE id = ?")
        .bind(provisioned.databaseName, provisioned.databaseUrl, WORLD_SCHEMA_VERSION, now(), existing.id)
        .run();
      await recordUsage(c.env, { organizationId: organization.id, worldId: existing.id, metric: "world.sync.count" });
      const row = await first<WorldRow>(database.prepare("SELECT * FROM worlds WHERE id = ?").bind(existing.id));
      return c.json({ world: row ? worldResource(organization.slug, row) : null, syncReport: provisioned.syncReport });
    } catch (error) {
      const message = error instanceof Error ? error.message : "World sync failed";
      await database.prepare("UPDATE worlds SET provisioning_status = 'failed', provisioning_error = ?, updated_at = ? WHERE id = ?").bind(message, now(), existing.id).run();
      const row = await first<WorldRow>(database.prepare("SELECT * FROM worlds WHERE id = ?").bind(existing.id));
      return c.json({ error: { code: "WORLD_SYNC_BLOCKED", message }, world: row ? worldResource(organization.slug, row) : null }, 409);
    }
  });
