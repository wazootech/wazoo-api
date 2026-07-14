import { Hono } from "hono";
import type { AppEnv } from "../env";
import { all, first, id, now } from "../lib/db";
import { jsonBody, optionalString, requireString, resolveOrg } from "../lib/http";

export const organizations = new Hono<AppEnv>()
  .get("/organizations", async (c) => {
    const auth = c.get("auth");
    const rows = auth.organizationId
      ? await all(c.env.DB.prepare("SELECT * FROM organizations WHERE id = ? ORDER BY created_at DESC").bind(auth.organizationId))
      : await all(c.env.DB.prepare("SELECT * FROM organizations ORDER BY created_at DESC"));
    return c.json({ organizations: rows });
  })
  .post("/organizations", async (c) => {
    const body = await jsonBody(c);
    const organization = { id: id(), slug: requireString(body, "slug"), name: requireString(body, "name"), now: now() };
    await c.env.DB.prepare("INSERT INTO organizations (id, slug, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(organization.id, organization.slug, organization.name, organization.now, organization.now)
      .run();
    return c.json({ organization: { id: organization.id, slug: organization.slug, name: organization.name } }, 201);
  })
  .get("/organizations/:organizationId", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const row = await first(c.env.DB.prepare("SELECT * FROM organizations WHERE id = ?").bind(organization.id));
    return c.json({ organization: row });
  })
  .patch("/organizations/:organizationId", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const body = await jsonBody(c);
    const name = optionalString(body, "name");
    if (name) {
      await c.env.DB.prepare("UPDATE organizations SET name = ?, updated_at = ? WHERE id = ?").bind(name, now(), organization.id).run();
    }
    return c.json({ organization: await first(c.env.DB.prepare("SELECT * FROM organizations WHERE id = ?").bind(organization.id)) });
  });
