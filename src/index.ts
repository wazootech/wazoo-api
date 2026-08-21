import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import type { AppEnv } from "./env";
import { registerAuthRoutes } from "./routes/auth";
import { registerBillingRoutes, stripeWebhook } from "./routes/billing";
import { registerHealthRoutes } from "./routes/health";
import { registerTokensRoutes } from "./routes/tokens";
import { registerUsageRoutes } from "./routes/usage";
import { registerUsersRoutes } from "./routes/users";
import { registerWorldsRoutes } from "./routes/worlds";
import { errorHandler, requireAuth } from "./lib/http";

const app = new OpenAPIHono<AppEnv>();

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return null;
      if (origin.endsWith(".wazoo.dev")) return origin;
      if (origin.startsWith("http://localhost:")) return origin;
      return null;
    },
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  }),
);

app.onError(errorHandler);
app.notFound((c) =>
  c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404),
);

app.openAPIRegistry.registerComponent(
  "securitySchemes",
  "bearerPlatformToken",
  {
    type: "http",
    scheme: "bearer",
    bearerFormat: "wzp",
    description: "Wazoo platform API token.",
  },
);

registerHealthRoutes(app);
app.route("/", stripeWebhook);
registerAuthRoutes(app);

app.use("/v1/*", requireAuth);
registerUsersRoutes(app);
registerWorldsRoutes(app);
registerTokensRoutes(app);
registerUsageRoutes(app);
registerBillingRoutes(app);

/**
 * openApiDocOptions is the OpenAPI document configuration. It is the single
 * source of truth for the served spec (GET /openapi.json) and the committed
 * snapshot in openapi/openapi.json, so the two cannot drift apart.
 */
export const openApiDocOptions = {
  openapi: "3.0.0",
  info: {
    title: "Wazoo Platform API",
    version: "0.1.0",
    description:
      "Management-plane API for Wazoo users, Worlds, platform tokens, usage, limits, and beta billing.",
  },
  servers: [
    { url: "https://api.wazoo.dev", description: "Wazoo Platform API" },
  ],
  security: [{ bearerPlatformToken: [] }],
};

app.doc("/openapi.json", openApiDocOptions);

export default app;
