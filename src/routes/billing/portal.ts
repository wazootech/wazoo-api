import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../env";
import { requireScope, resolveUser, respond } from "../../lib/http";
import { worldIdParam } from "../../lib/schemas";
import { resolveWorldBilling } from "./shared";

export function registerOpenBillingPortal(app: OpenAPIHono<AppEnv>) {
  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/worlds/{worldId}/billing/openPortal",
      tags: ["Billing"],
      operationId: "openWorldBillingPortal",
      summary: "Open billing portal",
      "x-mint": { metadata: { title: "Open billing portal" } },
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
        400: {
          description: "Not available",
          content: {
            "application/json": {
              schema: z.object({
                error: z.object({ code: z.string(), message: z.string() }),
              }),
            },
          },
        },
      },
    }),
    async (c) => {
      requireScope(c, "billing.read");
      const query = c.req.valid("query");
      const user = await resolveUser(c, query.email ?? undefined);
      await resolveWorldBilling(c, user.uid, c.req.param("worldId"));
      return respond(
        c,
        {
          error: {
            code: "FAILED_PRECONDITION",
            message: "Billing portal is not available for beta-free worlds",
          },
        },
        400,
      );
    },
  );
}
