import { Hono } from "hono";
import type { AppEnv } from "../env";
import { all, first, id, now } from "../lib/db";
import { jsonBody, requireResourceId, requireString, resolveOrg } from "../lib/http";

type OrganizationRow = { id: string; slug: string; name: string; state: string; created_at?: string; updated_at?: string };

function organizationResource(row: OrganizationRow) {
  return {
    name: `organizations/${row.slug}`,
    uid: row.id,
    displayName: row.name,
    state: row.state,
    createTime: row.created_at,
    updateTime: row.updated_at
  };
}

export const organizations = new Hono<AppEnv>()
  .get("/organizations", async (c) => {
    const auth = c.get("auth");
    const rows = auth.organizationId
      ? await all(c.env.DB.prepare("SELECT * FROM organizations WHERE id = ? ORDER BY created_at DESC").bind(auth.organizationId))
      : await all(c.env.DB.prepare("SELECT * FROM organizations ORDER BY created_at DESC"));
    return c.json({ organizations: rows.map((row) => organizationResource(row as OrganizationRow)) });
  })
  .post("/organizations", async (c) => {
    const body = await jsonBody(c);
    const organizationBody = body.organization;
    if (!organizationBody || typeof organizationBody !== "object" || Array.isArray(organizationBody)) {
      return c.json({ error: { message: "organization is required" } }, 400);
    }
    const organization = { id: `org_${id()}`, slug: requireResourceId(body, "organizationId"), name: requireString(organizationBody as Record<string, unknown>, "displayName"), now: now() };
    await c.env.DB.prepare("INSERT INTO organizations (id, slug, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(organization.id, organization.slug, organization.name, organization.now, organization.now)
      .run();
    return c.json({ organization: organizationResource({ ...organization, state: "ACTIVE", created_at: organization.now, updated_at: organization.now }) }, 201);
  })
  .get("/organizations/:organizationId", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const row = await first<OrganizationRow>(c.env.DB.prepare("SELECT * FROM organizations WHERE id = ?").bind(organization.id));
    return c.json({ organization: row ? organizationResource(row) : null });
  })
  .patch("/organizations/:organizationId", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const body = await jsonBody(c);
    if (body.updateMask !== "displayName") {
      return c.json({ error: { message: "updateMask must be displayName" } }, 400);
    }
    const organizationBody = body.organization;
    if (!organizationBody || typeof organizationBody !== "object" || Array.isArray(organizationBody)) {
      return c.json({ error: { message: "organization is required" } }, 400);
    }
    await c.env.DB.prepare("UPDATE organizations SET name = ?, updated_at = ? WHERE id = ?").bind(requireString(organizationBody as Record<string, unknown>, "displayName"), now(), organization.id).run();
    const row = await first<OrganizationRow>(c.env.DB.prepare("SELECT * FROM organizations WHERE id = ?").bind(organization.id));
    return c.json({ organization: row ? organizationResource(row) : null });
  })
  .delete("/organizations/:organizationId", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    await c.env.DB.prepare("DELETE FROM organizations WHERE id = ?").bind(organization.id).run();
    return c.body(null, 204);
  });
