import { Hono } from "hono";
import type { AppEnv } from "../env";
import { all, first, id, now } from "../lib/db";
import { jsonBody, optionalString, requireString, resolveOrg } from "../lib/http";

export const groups = new Hono<AppEnv>()
  .get("/organizations/:organizationId/groups", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const rows = await all(c.env.DB.prepare("SELECT * FROM groups WHERE organization_id = ? ORDER BY created_at DESC").bind(organization.id));
    return c.json({ groups: rows });
  })
  .post("/organizations/:organizationId/groups", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const body = await jsonBody(c);
    const name = requireString(body, "name");
    const group = { id: id(), slug: optionalString(body, "slug") ?? name, name, now: now() };
    await c.env.DB.prepare(
      "INSERT INTO groups (id, organization_id, slug, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(group.id, organization.id, group.slug, group.name, group.now, group.now)
      .run();
    return c.json({ group: { id: group.id, organizationId: organization.id, slug: group.slug, name: group.name } }, 201);
  })
  .get("/organizations/:organizationId/groups/:groupId", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const groupId = c.req.param("groupId");
    const group = await first(c.env.DB.prepare("SELECT * FROM groups WHERE organization_id = ? AND (id = ? OR slug = ?)").bind(organization.id, groupId, groupId));
    return group ? c.json({ group }) : c.notFound();
  })
  .delete("/organizations/:organizationId/groups/:groupId", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const groupId = c.req.param("groupId");
    const group = await first(c.env.DB.prepare("SELECT * FROM groups WHERE organization_id = ? AND (id = ? OR slug = ?)").bind(organization.id, groupId, groupId));
    if (!group) return c.notFound();
    await c.env.DB.prepare("DELETE FROM groups WHERE id = ?").bind(group.id).run();
    return c.json({ group });
  });
