import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../env";
import { all, db, first, id } from "../lib/db";
import { jsonBody, optionalString, requireScope, requireString, resolveOrg } from "../lib/http";

export const usage = new Hono<AppEnv>()
  .get("/organizations/:organizationId/usage", async (c) => {
    requireScope(c, "usage.read");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const database = db(c.env);
    const rows = await all(
      database.prepare(
        "SELECT metric, SUM(quantity) AS quantity FROM usage_events WHERE organization_id = ? GROUP BY metric ORDER BY metric"
      ).bind(organization.id)
    );
    const events = await all(database.prepare("SELECT id, world_id AS world, metric, quantity, unit, provider_cost_microcents AS providerCostMicrocents, wazoo_markup_microcents AS wazooMarkupMicrocents, estimated_cost_microcents AS estimatedCostMicrocents, billing_source AS billingSource, occurred_at AS occurredAt, created_at AS createTime FROM usage_events WHERE organization_id = ? ORDER BY occurred_at DESC LIMIT 100").bind(organization.id));
    return c.json({ usage: { organization: organization.id, total: rows, events } });
  })
  .get("/organizations/:organizationId/limits", async (c) => {
    requireScope(c, "usage.read");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const limits = await all(
      db(c.env).prepare("SELECT metric, limit_quantity AS limitQuantity FROM organization_limits WHERE organization_id = ? ORDER BY metric").bind(organization.id)
    );
    return c.json({ limits });
  })
  .get("/organizations/:organizationId/worlds/:worldId/usage", async (c) => {
    requireScope(c, "usage.read");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const database = db(c.env);
    const world = await first<{ id: string }>(database.prepare("SELECT id FROM worlds WHERE organization_id = ? AND slug = ?").bind(organization.id, worldId));
    if (!world) return c.notFound();
    const rows = await all(database.prepare("SELECT metric, SUM(quantity) AS quantity FROM usage_events WHERE organization_id = ? AND world_id = ? GROUP BY metric ORDER BY metric").bind(organization.id, world.id));
    const events = await all(database.prepare("SELECT id, world_id AS world, metric, quantity, unit, provider_cost_microcents AS providerCostMicrocents, wazoo_markup_microcents AS wazooMarkupMicrocents, estimated_cost_microcents AS estimatedCostMicrocents, billing_source AS billingSource, occurred_at AS occurredAt, created_at AS createTime FROM usage_events WHERE organization_id = ? AND world_id = ? ORDER BY occurred_at DESC LIMIT 100").bind(organization.id, world.id));
    return c.json({ usage: { world: world.id, total: rows, events } });
  })
  .post("/organizations/:organizationId/usage", async (c) => {
    requireScope(c, "admin");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const body = await jsonBody(c);
    const quantity = body.quantity;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) {
      return c.json({ error: { code: "INVALID_ARGUMENT", message: "quantity must be a positive integer" } }, 400);
    }
    const metric = requireString(body, "metric");
    const unit = optionalString(body, "unit") ?? "count";
    const providerCostMicrocents = optionalInteger(body, "providerCostMicrocents");
    const wazooMarkupMicrocents = optionalInteger(body, "wazooMarkupMicrocents") ?? 0;
    const estimatedCostMicrocents = optionalInteger(body, "estimatedCostMicrocents") ?? providerCostMicrocents;
    const billingSource = optionalString(body, "billingSource") ?? "BETA_FREE";
    const database = db(c.env);
    const worldResourceId = optionalString(body, "worldId") ?? optionalString(body, "world");
    const world = worldResourceId
      ? await first<{ id: string }>(database.prepare("SELECT id FROM worlds WHERE organization_id = ? AND slug = ?").bind(organization.id, worldResourceId))
      : null;
    if (worldResourceId && !world) return c.notFound();
    const limit = await first<{ limit_quantity: number }>(
      database.prepare("SELECT limit_quantity FROM organization_limits WHERE organization_id = ? AND metric = ?").bind(organization.id, metric)
    );
    if (limit) {
      const current = await first<{ quantity: number }>(
        database.prepare("SELECT COALESCE(SUM(quantity), 0) AS quantity FROM usage_events WHERE organization_id = ? AND metric = ?").bind(organization.id, metric)
      );
      if ((current?.quantity ?? 0) + quantity > limit.limit_quantity) {
        return c.json({ error: { code: "RESOURCE_EXHAUSTED", message: `Limit exceeded for ${metric}` }, quota: { state: "THROTTLED", reason: `${metric.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_EXCEEDED` } }, 429);
      }
    }
    await database.prepare(
      "INSERT INTO usage_events (id, organization_id, world_id, metric, quantity, unit, provider_cost_microcents, wazoo_markup_microcents, estimated_cost_microcents, billing_source, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(id(), organization.id, world?.id ?? null, metric, quantity, unit, providerCostMicrocents, wazooMarkupMicrocents, estimatedCostMicrocents, billingSource, optionalString(body, "occurredAt") ?? new Date().toISOString())
      .run();
    return c.json({ accepted: true }, 201);
  });

function optionalInteger(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new HTTPException(400, { message: `${key} must be an integer` });
  }
  return value;
}
