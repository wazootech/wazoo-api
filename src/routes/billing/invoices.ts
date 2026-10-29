import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../env";
import { requireScope, resolveUser, respond } from "../../lib/http";
import { worldIdParam, InvoicesListSchema } from "../../lib/schemas";
import { resolveWorldBilling } from "./shared";

export function registerListWorldInvoices(app: OpenAPIHono<AppEnv>) {
  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/worlds/{worldId}/billing/invoices",
      tags: ["Billing"],
      operationId: "listWorldInvoices",
      summary: "List world invoices",
      "x-mint": { metadata: { title: "List world invoices" } },
      security: [{ bearerPlatformToken: [] }],
      request: {
        params: worldIdParam,
        query: z.object({
          email: z
            .string()
            .optional()
            .openapi({ param: { name: "email", in: "query" } }),
        }),
      },
      responses: {
        200: {
          description: "World invoices",
          content: { "application/json": { schema: InvoicesListSchema } },
        },
      },
    }),
    async (c) => {
      requireScope(c, "billing.read");
      const query = c.req.valid("query");
      const user = await resolveUser(c, query.email ?? undefined);
      await resolveWorldBilling(c, user.uid, c.req.param("worldId"));
      return respond(c, { invoices: [] });
    },
  );
}
