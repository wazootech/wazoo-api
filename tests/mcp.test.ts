import { describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../src/env";
import { registerMcpRoute } from "../src/routes/mcp";

describe("MCP route", () => {
  it("registers the /mcp endpoint", () => {
    const app = new OpenAPIHono<AppEnv>();
    registerMcpRoute(app);

    // Check that the route is registered
    const routes = app.routes;
    const mcpRoute = routes.find(
      (r) => r.path === "/mcp" && r.method === "ALL",
    );
    expect(mcpRoute).toBeDefined();
  });

  it("returns 401 for requests without a platform token (fail closed)", async () => {
    const app = new OpenAPIHono<AppEnv>();
    registerMcpRoute(app);

    const res = await app.request("/mcp", {
      method: "GET",
    });

    // Auth is checked in-route as well as by middleware, so an unmounted
    // middleware cannot leave the endpoint open (wazoo-api#159).
    expect(res.status).toBe(401);
  });
});
