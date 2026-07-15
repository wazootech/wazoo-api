import { Hono } from "hono";
import type { AppEnv } from "../env";
import { all, first, id, now } from "../lib/db";
import { jsonBody, optionalString, requireOrgAccess, requireResourceId, requireString, resolveOrg } from "../lib/http";

type WorldRow = { id: string; slug: string; name: string; region: string; status: string; created_at?: string; updated_at?: string; deleted_at?: string | null; expire_at?: string | null };

function worldResource(organizationId: string, row: WorldRow) {
  return {
    name: `organizations/${organizationId}/worlds/${row.slug}`,
    uid: row.id,
    displayName: row.name,
    region: row.region,
    state: row.status.toUpperCase(),
    restorable: false,
    storage: { backend: "TURSO" },
    provisioning: { state: row.status === "active" ? "ACTIVE" : row.status.toUpperCase() },
    durability: { backend: "R2", state: "NOT_CONFIGURED" },
    createTime: row.created_at,
    updateTime: row.updated_at,
    deleteTime: row.deleted_at ?? undefined,
    expireTime: row.expire_at ?? undefined
  };
}

export const worlds = new Hono<AppEnv>()
  .get("/organizations/:organizationId/worlds", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const rows = await all<WorldRow>(c.env.DB.prepare("SELECT * FROM worlds WHERE organization_id = ? ORDER BY created_at DESC").bind(organization.id));
    return c.json({ worlds: rows.map((row) => worldResource(organization.slug, row)) });
  })
  .post("/organizations/:organizationId/worlds", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const body = await jsonBody(c);
    const worldBody = body.world;
    if (!worldBody || typeof worldBody !== "object" || Array.isArray(worldBody)) {
      return c.json({ error: { message: "world is required" } }, 400);
    }
    const world = {
      id: `w_${id()}`,
      slug: requireResourceId(body, "worldId"),
      name: requireString(worldBody as Record<string, unknown>, "displayName"),
      region: optionalString(worldBody as Record<string, unknown>, "region") ?? "auto",
      now: now()
    };
    await c.env.DB.prepare(
      "INSERT INTO worlds (id, organization_id, slug, name, region, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(world.id, organization.id, world.slug, world.name, world.region, world.now, world.now)
      .run();
    return c.json({ world: worldResource(organization.slug, { ...world, status: "active", created_at: world.now, updated_at: world.now }) }, 201);
  })
  .get("/organizations/:organizationId/worlds/:worldId", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const world = await first<WorldRow>(c.env.DB.prepare("SELECT * FROM worlds WHERE organization_id = ? AND slug = ?").bind(organization.id, worldId));
    if (!world) return c.notFound();
    return c.json({ world: worldResource(organization.slug, world) });
  })
  .patch("/organizations/:organizationId/worlds/:worldId", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const existing = await first<{ id: string; organization_id: string }>(c.env.DB.prepare("SELECT * FROM worlds WHERE organization_id = ? AND slug = ?").bind(organization.id, worldId));
    if (!existing) return c.notFound();
    requireOrgAccess(c, existing.organization_id);
    const body = await jsonBody(c);
    const updateMask = requireString(body, "updateMask").split(",").map((field) => field.trim()).filter(Boolean);
    const allowed = new Set(["displayName", "region", "state"]);
    if (updateMask.some((field) => !allowed.has(field))) {
      return c.json({ error: { message: "updateMask contains unknown fields" } }, 400);
    }
    const worldBody = body.world;
    if (!worldBody || typeof worldBody !== "object" || Array.isArray(worldBody)) {
      return c.json({ error: { message: "world is required" } }, 400);
    }
    const patch = worldBody as Record<string, unknown>;
    await c.env.DB.prepare("UPDATE worlds SET name = COALESCE(?, name), region = COALESCE(?, region), status = COALESCE(?, status), updated_at = ? WHERE id = ?")
      .bind(updateMask.includes("displayName") ? requireString(patch, "displayName") : null, updateMask.includes("region") ? requireString(patch, "region") : null, updateMask.includes("state") ? requireString(patch, "state").toLowerCase() : null, now(), existing.id)
      .run();
    const row = await first<WorldRow>(c.env.DB.prepare("SELECT * FROM worlds WHERE id = ?").bind(existing.id));
    return c.json({ world: row ? worldResource(organization.slug, row) : null });
  })
  .delete("/organizations/:organizationId/worlds/:worldId", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const existing = await first<{ id: string }>(c.env.DB.prepare("SELECT * FROM worlds WHERE organization_id = ? AND slug = ?").bind(organization.id, worldId));
    if (!existing) return c.notFound();
    const deletedAt = now();
    const expireAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await c.env.DB.prepare("UPDATE worlds SET status = 'deleted', deleted_at = ?, expire_at = ?, updated_at = ? WHERE id = ?").bind(deletedAt, expireAt, deletedAt, existing.id).run();
    await c.env.DB.prepare("DELETE FROM world_auth_tokens WHERE world_id = ?").bind(existing.id).run();
    const row = await first<WorldRow>(c.env.DB.prepare("SELECT * FROM worlds WHERE id = ?").bind(existing.id));
    return c.json({ world: row ? worldResource(organization.slug, row) : null });
  })
  .post("/organizations/:organizationId/worlds/:worldId\\:undelete", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const existing = await first<{ id: string; status: string }>(c.env.DB.prepare("SELECT * FROM worlds WHERE organization_id = ? AND slug = ?").bind(organization.id, worldId));
    if (!existing) return c.notFound();
    if (existing.status !== "deleted") {
      return c.json({ error: { message: "World is not deleted" } }, 400);
    }
    await c.env.DB.prepare("UPDATE worlds SET status = 'active', deleted_at = NULL, expire_at = NULL, updated_at = ? WHERE id = ?").bind(now(), existing.id).run();
    const row = await first<WorldRow>(c.env.DB.prepare("SELECT * FROM worlds WHERE id = ?").bind(existing.id));
    return c.json({ world: row ? worldResource(organization.slug, row) : null });
  })
  .post("/organizations/:organizationId/worlds/:worldId\\:sync", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const existing = await first<{ id: string }>(c.env.DB.prepare("SELECT * FROM worlds WHERE organization_id = ? AND slug = ?").bind(organization.id, worldId));
    if (!existing) return c.notFound();
    await c.env.DB.prepare("UPDATE worlds SET updated_at = ? WHERE id = ?").bind(now(), existing.id).run();
    const row = await first<WorldRow>(c.env.DB.prepare("SELECT * FROM worlds WHERE id = ?").bind(existing.id));
    return c.json({ world: row ? worldResource(organization.slug, row) : null });
  });
