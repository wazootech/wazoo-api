import { Hono } from "hono";
import type { AppEnv } from "../env";
import { all, first, id, now } from "../lib/db";
import { jsonBody, optionalString, requireOrgAccess, requireString, resolveOrg } from "../lib/http";

export const worlds = new Hono<AppEnv>()
  .get("/organizations/:organizationId/worlds", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const rows = await all(c.env.DB.prepare("SELECT *, name AS label FROM worlds WHERE organization_id = ? ORDER BY created_at DESC").bind(organization.id));
    return c.json({ worlds: rows });
  })
  .post("/organizations/:organizationId/worlds", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const body = await jsonBody(c);
    const label = optionalString(body, "label") ?? requireString(body, "name");
    const world = {
      id: id(),
      slug: optionalString(body, "slug") ?? label,
      name: label,
      region: optionalString(body, "region") ?? "auto",
      now: now()
    };
    await c.env.DB.prepare(
      "INSERT INTO worlds (id, organization_id, slug, name, region, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(world.id, organization.id, world.slug, world.name, world.region, world.now, world.now)
      .run();
    return c.json({ world: { id: world.id, organizationId: organization.id, slug: world.slug, label: world.name, name: world.name, region: world.region } }, 201);
  })
  .get("/organizations/:organizationId/worlds/:worldId", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const world = await first<{ id: string; organization_id: string }>(c.env.DB.prepare("SELECT *, name AS label FROM worlds WHERE organization_id = ? AND (id = ? OR slug = ?)").bind(organization.id, worldId, worldId));
    if (!world) return c.notFound();
    return c.json({ world });
  })
  .patch("/organizations/:organizationId/worlds/:worldId", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const existing = await first<{ id: string; organization_id: string }>(c.env.DB.prepare("SELECT * FROM worlds WHERE organization_id = ? AND (id = ? OR slug = ?)").bind(organization.id, worldId, worldId));
    if (!existing) return c.notFound();
    requireOrgAccess(c, existing.organization_id);
    const body = await jsonBody(c);
    await c.env.DB.prepare("UPDATE worlds SET name = COALESCE(?, name), status = COALESCE(?, status), updated_at = ? WHERE id = ?")
      .bind(optionalString(body, "label") ?? optionalString(body, "name"), optionalString(body, "status"), now(), existing.id)
      .run();
    return c.json({ world: await first(c.env.DB.prepare("SELECT *, name AS label FROM worlds WHERE id = ?").bind(existing.id)) });
  })
  .delete("/organizations/:organizationId/worlds/:worldId", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const existing = await first<{ id: string }>(c.env.DB.prepare("SELECT * FROM worlds WHERE organization_id = ? AND (id = ? OR slug = ?)").bind(organization.id, worldId, worldId));
    if (!existing) return c.notFound();
    await c.env.DB.prepare("DELETE FROM worlds WHERE id = ?").bind(existing.id).run();
    return c.body(null, 204);
  });
