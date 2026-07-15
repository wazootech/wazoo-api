import { Hono } from "hono";
import type { AppEnv } from "../env";
import { all, db, first, id } from "../lib/db";
import { jsonBody, optionalString, requireScope, requireString, resolveOrg } from "../lib/http";

export const usage = new Hono<AppEnv>()
  .get("/organizations/:organizationId/usage", async (c) => {
    requireScope(c, "usage.read");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const rows = await all(
      db(c.env).prepare(
        "SELECT metric, SUM(quantity) AS quantity FROM usage_events WHERE organization_id = ? GROUP BY metric ORDER BY metric"
      ).bind(organization.id)
    );
    return c.json({ usage: { organization: organization.id, total: rows } });
  })
  .get("/organizations/:organizationId/worlds/:worldId/usage", async (c) => {
    requireScope(c, "usage.read");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const world = await first<{ id: string }>(db(c.env).prepare("SELECT id FROM worlds WHERE organization_id = ? AND slug = ?").bind(organization.id, worldId));
    if (!world) return c.notFound();
    const rows = await all(db(c.env).prepare("SELECT metric, SUM(quantity) AS quantity FROM usage_events WHERE organization_id = ? AND world_id = ? GROUP BY metric ORDER BY metric").bind(organization.id, world.id));
    return c.json({ usage: { world: world.id, total: rows } });
  })
  .post("/organizations/:organizationId/usage", async (c) => {
    requireScope(c, "admin");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const body = await jsonBody(c);
    const quantity = body.quantity;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) {
      return c.json({ error: { code: "INVALID_ARGUMENT", message: "quantity must be a positive integer" } }, 400);
    }
    await db(c.env).prepare(
      "INSERT INTO usage_events (id, organization_id, world_id, metric, quantity, occurred_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(id(), organization.id, optionalString(body, "worldId"), requireString(body, "metric"), quantity, optionalString(body, "occurredAt") ?? new Date().toISOString())
      .run();
    return c.json({ accepted: true }, 201);
  });
