import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "./env";
import { registerBillingRoutes, stripeWebhook } from "./routes/billing";
import { registerHealthRoutes } from "./routes/health";
import { registerTokensRoutes } from "./routes/tokens";
import { registerUsageRoutes } from "./routes/usage";
import { registerUsersRoutes } from "./routes/users";
import { registerWorldsRoutes } from "./routes/worlds";
import { errorHandler, requireAuth } from "./lib/http";

const app = new OpenAPIHono<AppEnv>();

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

app.use("/v1/*", requireAuth);
registerUsersRoutes(app);
registerWorldsRoutes(app);
registerTokensRoutes(app);
registerUsageRoutes(app);
registerBillingRoutes(app);

app.doc("/openapi.json", {
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
});

export default app;
