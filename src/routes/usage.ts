import { Hono } from "hono";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../env";
import { recordAdminAudit } from "../lib/audit";
import { all, db, first, id } from "../lib/db";
import {
  jsonBody,
  optionalString,
  requireScope,
  requireString,
  resolveUser,
} from "../lib/http";

export const usage = new Hono<AppEnv>()
  .get("/worlds/:worldId/usage", async (c) => {
    requireScope(c, "usage.read");
    const user = await resolveUser(c, c.req.query("email") ?? undefined);
    const world = await resolveWorld(c, user.uid, c.req.param("worldId"));
    const range = usageRange(c);
    const database = db(c.env);
    const rows = await all(
      database
        .prepare(
          `SELECT metric, SUM(quantity) AS quantity FROM usage_events WHERE world_uid = ?${range.where} GROUP BY metric ORDER BY metric`,
        )
        .bind(world.uid, ...range.args),
    );
    const eventRows = await all<UsageEventRow>(
      database
        .prepare(
          `SELECT uid, metric, quantity, unit, provider_cost_microcents AS providerCostMicrocents, wazoo_markup_microcents AS wazooMarkupMicrocents, estimated_cost_microcents AS estimatedCostMicrocents, billing_source AS billingSource, create_time AS createTime FROM usage_events WHERE world_uid = ?${range.where} ORDER BY create_time DESC LIMIT 100`,
        )
        .bind(world.uid, ...range.args),
    );
    return c.json({
      usage: {
        world: `worlds/${world.world_id}`,
        total: rows,
        events: eventRows.map(usageEventResource),
      },
    });
  })
  .get("/worlds/:worldId/limits", async (c) => {
    requireScope(c, "usage.read");
    const user = await resolveUser(c, c.req.query("email") ?? undefined);
    const world = await resolveWorld(c, user.uid, c.req.param("worldId"));
    const limits = await all(
      db(c.env)
        .prepare(
          "SELECT metric, limit_quantity AS limitQuantity FROM world_limits WHERE world_uid = ? ORDER BY metric",
        )
        .bind(world.uid),
    );
    return c.json({ limits });
  })
  .post("/worlds/:worldId/usage", async (c) => {
    requireScope(c, "admin");
    const body = await jsonBody(c);
    const user = await resolveUser(
      c,
      optionalString(body, "user") ??
        optionalString(body, "email") ??
        undefined,
    );
    const world = await resolveWorld(c, user.uid, c.req.param("worldId"));
    const quantity = body.quantity;
    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity < 1
    ) {
      return c.json(
        {
          error: {
            code: "INVALID_ARGUMENT",
            message: "quantity must be a positive integer",
          },
        },
        400,
      );
    }
    const metric = requireString(body, "metric");
    const unit = optionalString(body, "unit") ?? "count";
    const providerCostMicrocents = optionalInteger(
      body,
      "providerCostMicrocents",
    );
    const wazooMarkupMicrocents =
      optionalInteger(body, "wazooMarkupMicrocents") ?? 0;
    const estimatedCostMicrocents =
      optionalInteger(body, "estimatedCostMicrocents") ??
      providerCostMicrocents;
    const billingSource = optionalString(body, "billingSource") ?? "BETA_FREE";
    const database = db(c.env);
    const limit = await first<{ limit_quantity: number }>(
      database
        .prepare(
          "SELECT limit_quantity FROM world_limits WHERE world_uid = ? AND metric = ?",
        )
        .bind(world.uid, metric),
    );
    if (limit) {
      const current = await first<{ quantity: number }>(
        database
          .prepare(
            "SELECT COALESCE(SUM(quantity), 0) AS quantity FROM usage_events WHERE world_uid = ? AND metric = ?",
          )
          .bind(world.uid, metric),
      );
      if ((current?.quantity ?? 0) + quantity > limit.limit_quantity) {
        return c.json(
          {
            error: {
              code: "RESOURCE_EXHAUSTED",
              message: `Limit exceeded for ${metric}`,
            },
            quota: {
              state: "THROTTLED",
              reason: `${metric.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_EXCEEDED`,
            },
          },
          429,
        );
      }
    }
    await database
      .prepare(
        "INSERT INTO usage_events (uid, user_uid, world_uid, metric, quantity, unit, provider_cost_microcents, wazoo_markup_microcents, estimated_cost_microcents, billing_source, create_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        id(),
        user.uid,
        world.uid,
        metric,
        quantity,
        unit,
        providerCostMicrocents,
        wazooMarkupMicrocents,
        estimatedCostMicrocents,
        billingSource,
        optionalString(body, "createTime") ?? new Date().toISOString(),
      )
      .run();
    await recordAdminAudit(c, {
      action: "usage.record",
      targetResourceName: `worlds/${world.world_id}/usageEvents`,
    });
    return c.json({ accepted: true }, 201);
  });

async function resolveWorld(
  c: Context<AppEnv>,
  userUid: string,
  worldId: string,
): Promise<{ uid: string; world_id: string }> {
  const world = await first<{ uid: string; world_id: string }>(
    db(c.env)
      .prepare(
        "SELECT uid, world_id FROM worlds WHERE user_uid = ? AND world_id = ?",
      )
      .bind(userUid, worldId),
  );
  if (!world) throw new HTTPException(404, { message: "World not found" });
  return world;
}

function optionalInteger(
  body: Record<string, unknown>,
  key: string,
): number | null {
  const value = body[key];
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new HTTPException(400, { message: `${key} must be an integer` });
  }
  return value;
}

type UsageEventRow = {
  uid: string;
  metric: string;
  quantity: number;
  unit: string;
  providerCostMicrocents?: number | null;
  wazooMarkupMicrocents?: number;
  estimatedCostMicrocents?: number | null;
  billingSource: string;
  createTime: string;
};

function usageEventResource(row: UsageEventRow) {
  return {
    name: `usageEvents/${row.uid}`,
    metric: row.metric,
    quantity: row.quantity,
    unit: row.unit,
    providerCostMicrocents: row.providerCostMicrocents,
    wazooMarkupMicrocents: row.wazooMarkupMicrocents,
    estimatedCostMicrocents: row.estimatedCostMicrocents,
    billingSource: row.billingSource,
    createTime: row.createTime,
  };
}

function usageRange(c: { req: { query(name: string): string | undefined } }) {
  const args: string[] = [];
  let where = "";
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (from) {
    where += " AND create_time >= ?";
    args.push(from);
  }
  if (to) {
    where += " AND create_time <= ?";
    args.push(to);
  }
  return { where, args };
}
