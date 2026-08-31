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

  it("returns 405 for GET requests without proper MCP headers", async () => {
    const app = new OpenAPIHono<AppEnv>();
    registerMcpRoute(app);

    const res = await app.request("/mcp", {
      method: "GET",
    });

    // MCP Streamable HTTP requires specific headers
    // Without them, it should return an error
    expect(res.status).toBe(405);
  });
});
