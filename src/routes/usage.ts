import { Hono } from "hono";
import type { AppEnv } from "../env";
import { all, first, id } from "../lib/db";
import { jsonBody, optionalString, requireString, resolveOrg } from "../lib/http";

export const usage = new Hono<AppEnv>()
  .get("/organizations/:organizationId/usage", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const rows = await all(
      c.env.DB.prepare(
        "SELECT metric, SUM(quantity) AS quantity FROM usage_events WHERE organization_id = ? GROUP BY metric ORDER BY metric"
      ).bind(organization.id)
    );
    return c.json({ usage: { organization: organization.id, total: rows } });
  })
  .get("/organizations/:organizationId/worlds/:worldId/usage", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const world = await first<{ id: string }>(c.env.DB.prepare("SELECT id FROM worlds WHERE organization_id = ? AND slug = ?").bind(organization.id, worldId));
    if (!world) return c.notFound();
    const rows = await all(c.env.DB.prepare("SELECT metric, SUM(quantity) AS quantity FROM usage_events WHERE organization_id = ? AND world_id = ? GROUP BY metric ORDER BY metric").bind(organization.id, world.id));
    return c.json({ usage: { world: world.id, total: rows } });
  })
  .post("/organizations/:organizationId/usage", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const body = await jsonBody(c);
    const quantity = body.quantity;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) {
      return c.json({ error: { message: "quantity must be a positive integer" } }, 400);
    }
    await c.env.DB.prepare(
      "INSERT INTO usage_events (id, organization_id, world_id, metric, quantity, occurred_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(id(), organization.id, optionalString(body, "worldId"), requireString(body, "metric"), quantity, optionalString(body, "occurredAt") ?? new Date().toISOString())
      .run();
    return c.json({ accepted: true }, 201);
  });
