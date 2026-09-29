import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { db } from "../lib/db";
import { assertWorldIdentitySchema } from "../lib/world-readiness";

const route = createRoute({
  method: "get",
  path: "/health",
  security: [],
  tags: ["Health"],
  operationId: "getHealth",
  summary: "Get health",
  "x-mint": { metadata: { title: "Get health" } },
  responses: {
    200: {
      description: "Service is healthy",
      content: {
        "application/json": { schema: z.object({ status: z.string() }) },
      },
    },
  },
});

const readinessRoute = createRoute({
  method: "get",
  path: "/ready",
  security: [],
  tags: ["Health"],
  operationId: "getReadiness",
  summary: "Get readiness",
  description:
    "Returns ready only when the management database uses the canonical world-identity schema.",
  "x-mint": { metadata: { title: "Get readiness" } },
  responses: {
    200: {
      description: "World identity schema is ready",
      content: {
        "application/json": {
          schema: z.object({ status: z.literal("ready") }),
        },
      },
    },
    503: {
      description: "World identity schema is unavailable or incompatible",
      content: {
        "application/json": {
          schema: z.object({
            status: z.literal("not_ready"),
            error: z.string(),
          }),
        },
      },
    },
  },
});

export function registerHealthRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(route, (c) => {
    return c.json({ status: "ok" });
  });

  app.openapi(readinessRoute, async (c) => {
    try {
      const database = db(c.env);
      await database.prepare("SELECT 1").first();
      await assertWorldIdentitySchema(database);
      return c.json({ status: "ready" }, 200);
    } catch (error) {
      console.error("Wazoo API readiness check failed", error);
      return c.json(
        {
          status: "not_ready",
          error: "World identity schema is unavailable or incompatible",
        },
        503,
      );
    }
  });
}
