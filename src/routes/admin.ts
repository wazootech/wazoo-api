import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { requireScope, respond } from "../lib/http";
import { createRoute, z } from "@hono/zod-openapi";
import { db } from "../lib/db";

const listAuditRoute = createRoute({
  method: "get",
  path: "/v1/admin/audit-events",
  tags: ["Admin"],
  operationId: "listAdminAuditEvents",
  summary: "List admin audit events",
  "x-mint": { metadata: { title: "List admin audit events" } },
  security: [{ bearerPlatformToken: [] }],
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
      offset: z.coerce.number().int().min(0).default(0).optional(),
    }),
  },
  responses: {
    200: {
      description: "List of admin audit events",
      content: {
        "application/json": {
          schema: z.object({
            auditEvents: z.array(
              z.object({
                uid: z.string(),
                actorTokenUid: z.string().nullable().optional(),
                action: z.string(),
                targetResourceName: z.string(),
                outcome: z.string(),
                errorCode: z.string().nullable().optional(),
                createTime: z.string(),
              }),
            ),
            total: z.number().optional(),
          }),
        },
      },
    },
    401: {
      description: "Not authenticated",
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({ code: z.string(), message: z.string() }),
          }),
        },
      },
    },
    403: {
      description: "Insufficient scope",
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({ code: z.string(), message: z.string() }),
          }),
        },
      },
    },
  },
});

export function registerAdminRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(listAuditRoute, async (c) => {
    requireScope(c, "admin");
    const { limit = 50, offset = 0 } = c.req.valid("query");
    const database = db(c.env);

    const rows = await database
      .prepare(
        "SELECT uid, actor_token_uid, action, target_resource_name, outcome, error_code, create_time FROM admin_audit_events ORDER BY create_time DESC LIMIT ? OFFSET ?",
      )
      .bind(limit, offset)
      .all<{
        uid: string;
        actor_token_uid: string | null;
        action: string;
        target_resource_name: string;
        outcome: string;
        error_code: string | null;
        create_time: string;
      }>();

    const count = await database
      .prepare("SELECT COUNT(*) as c FROM admin_audit_events")
      .first<{ c: number }>();

    return respond(c, {
      auditEvents: (rows.results ?? []).map((r) => ({
        uid: r.uid,
        actorTokenUid: r.actor_token_uid ?? undefined,
        action: r.action,
        targetResourceName: r.target_resource_name,
        outcome: r.outcome,
        errorCode: r.error_code ?? undefined,
        createTime: r.create_time,
      })),
      total: count?.c ?? 0,
    });
  });
}