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
    const range = usageRange(c);
    const rows = await all(
      database.prepare(
        `SELECT metric, SUM(quantity) AS quantity FROM usage_events WHERE organization_uid = ?${range.where} GROUP BY metric ORDER BY metric`
      ).bind(organization.uid, ...range.args)
    );
    const eventRows = await all<UsageEventRow>(database.prepare(`SELECT u.id, w.world_id AS worldId, u.metric, u.quantity, u.unit, u.provider_cost_microcents AS providerCostMicrocents, u.wazoo_markup_microcents AS wazooMarkupMicrocents, u.estimated_cost_microcents AS estimatedCostMicrocents, u.billing_source AS billingSource, u.occurred_at AS occurredAt, u.create_time AS createTime FROM usage_events u LEFT JOIN worlds w ON w.uid = u.world_uid WHERE u.organization_uid = ?${range.where.replaceAll("occurred_at", "u.occurred_at")} ORDER BY u.occurred_at DESC LIMIT 100`).bind(organization.uid, ...range.args));
    return c.json({ usage: { organization: `organizations/${organization.organizationId}`, total: rows, events: eventRows.map((row) => usageEventResource(organization.organizationId, row)) } });
  })
  .get("/organizations/:organizationId/limits", async (c) => {
    requireScope(c, "usage.read");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const limits = await all(
      db(c.env).prepare("SELECT metric, limit_quantity AS limitQuantity FROM organization_limits WHERE organization_uid = ? ORDER BY metric").bind(organization.uid)
    );
    return c.json({ limits });
  })
  .get("/organizations/:organizationId/worlds/:worldId/usage", async (c) => {
    requireScope(c, "usage.read");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const database = db(c.env);
    const world = await first<{ uid: string; world_id: string }>(database.prepare("SELECT uid, world_id FROM worlds WHERE organization_uid = ? AND world_id = ?").bind(organization.uid, worldId));
    if (!world) return c.notFound();
    const range = usageRange(c);
    const rows = await all(database.prepare(`SELECT metric, SUM(quantity) AS quantity FROM usage_events WHERE organization_uid = ? AND world_uid = ?${range.where} GROUP BY metric ORDER BY metric`).bind(organization.uid, world.uid, ...range.args));
    const eventRows = await all<UsageEventRow>(database.prepare(`SELECT u.id, w.world_id AS worldId, u.metric, u.quantity, u.unit, u.provider_cost_microcents AS providerCostMicrocents, u.wazoo_markup_microcents AS wazooMarkupMicrocents, u.estimated_cost_microcents AS estimatedCostMicrocents, u.billing_source AS billingSource, u.occurred_at AS occurredAt, u.create_time AS createTime FROM usage_events u LEFT JOIN worlds w ON w.uid = u.world_uid WHERE u.organization_uid = ? AND u.world_uid = ?${range.where.replaceAll("occurred_at", "u.occurred_at")} ORDER BY u.occurred_at DESC LIMIT 100`).bind(organization.uid, world.uid, ...range.args));
    return c.json({ usage: { world: `organizations/${organization.organizationId}/worlds/${world.world_id}`, total: rows, events: eventRows.map((row) => usageEventResource(organization.organizationId, row)) } });
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
    const resolvedWorldId = worldResourceId ? worldIdFromResource(worldResourceId) : null;
    const world = worldResourceId
      ? await first<{ uid: string }>(database.prepare("SELECT uid FROM worlds WHERE organization_uid = ? AND world_id = ?").bind(organization.uid, resolvedWorldId))
      : null;
    if (worldResourceId && !world) return c.notFound();
      const limit = await first<{ limit_quantity: number }>(
        database.prepare("SELECT limit_quantity FROM organization_limits WHERE organization_uid = ? AND metric = ?").bind(organization.uid, metric)
      );
    if (limit) {
      const current = await first<{ quantity: number }>(
        database.prepare("SELECT COALESCE(SUM(quantity), 0) AS quantity FROM usage_events WHERE organization_uid = ? AND metric = ?").bind(organization.uid, metric)
      );
      if ((current?.quantity ?? 0) + quantity > limit.limit_quantity) {
        return c.json({ error: { code: "RESOURCE_EXHAUSTED", message: `Limit exceeded for ${metric}` }, quota: { state: "THROTTLED", reason: `${metric.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_EXCEEDED` } }, 429);
      }
    }
    await database.prepare(
      "INSERT INTO usage_events (id, organization_uid, world_uid, metric, quantity, unit, provider_cost_microcents, wazoo_markup_microcents, estimated_cost_microcents, billing_source, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(id(), organization.uid, world?.uid ?? null, metric, quantity, unit, providerCostMicrocents, wazooMarkupMicrocents, estimatedCostMicrocents, billingSource, optionalString(body, "occurredAt") ?? new Date().toISOString())
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

type UsageEventRow = {
  id: string;
  worldId?: string | null;
  metric: string;
  quantity: number;
  unit: string;
  providerCostMicrocents?: number | null;
  wazooMarkupMicrocents?: number;
  estimatedCostMicrocents?: number | null;
  billingSource: string;
  occurredAt: string;
  createTime: string;
};

function usageEventResource(organizationId: string, row: UsageEventRow) {
  return {
    name: `organizations/${organizationId}/usageEvents/${row.id}`,
    organization: `organizations/${organizationId}`,
    world: row.worldId ? `organizations/${organizationId}/worlds/${row.worldId}` : undefined,
    metric: row.metric,
    quantity: row.quantity,
    unit: row.unit,
    providerCostMicrocents: row.providerCostMicrocents,
    wazooMarkupMicrocents: row.wazooMarkupMicrocents,
    estimatedCostMicrocents: row.estimatedCostMicrocents,
    billingSource: row.billingSource,
    occurredAt: row.occurredAt,
    createTime: row.createTime,
  };
}

function usageRange(c: { req: { query(name: string): string | undefined } }) {
  const args: string[] = [];
  let where = "";
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (from) {
    where += " AND occurred_at >= ?";
    args.push(from);
  }
  if (to) {
    where += " AND occurred_at <= ?";
    args.push(to);
  }
  return { where, args };
}

function worldIdFromResource(value: string): string {
  const marker = "/worlds/";
  const index = value.indexOf(marker);
  return index >= 0 ? value.slice(index + marker.length) : value;
}
