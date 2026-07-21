import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../env";

const route = createRoute({
  method: "get",
  path: "/health",
  security: [],
  tags: ["Health"],
  operationId: "getHealth",
  responses: {
    200: {
      description: "Service is healthy",
      content: {
        "application/json": { schema: z.object({ status: z.string() }) },
      },
    },
  },
});

export function registerHealthRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(route, (c) => {
    return c.json({ status: "ok" });
  });

  app.post("/debug-echo", async (c) => {
    const raw = await c.req.text();
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {}
    return c.json({ raw, parsed });
  });
}
