import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import * as z from "zod/v4";

/**
 * Register the MCP endpoint at /mcp.
 *
 * Streamable-HTTP MCP server that proxies read-only data-plane operations
 * through the worlds-api. Auth reuses the existing bearer platform token.
 *
 * Tool surface v0:
 * - wazoo_search_worlds: hybrid search across a world's graph
 * - wazoo_sparql_query: run a SPARQL query against a world
 * - wazoo_list_worlds: list all worlds for the authenticated user
 */
export function registerMcpRoute(app: OpenAPIHono<AppEnv>) {
  const worldsApiUrl = process.env.WORLDS_API_URL ?? "https://data.wazoo.dev";

  async function worldsFetch(
    path: string,
    token: string,
    init?: RequestInit,
  ): Promise<Response> {
    return fetch(`${worldsApiUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...init?.headers,
      },
    });
  }

  function buildServer(): McpServer {
    const server = new McpServer({ name: "wazoo", version: "0.1.0" });

    server.registerTool(
      "wazoo_search_worlds",
      {
        description:
          "Search across world graphs using hybrid vector + pattern matching",
        inputSchema: z.object({
          worldId: z.string().describe("World ID to search"),
          query: z.string().describe("Search query"),
          limit: z.number().optional().describe("Max results (default 10)"),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ worldId, query, limit }) => {
        const token = process.env.WORLDS_TOKEN ?? "";
        const res = await worldsFetch(`/worlds/${worldId}/search`, token, {
          method: "POST",
          body: JSON.stringify({ query, limit: limit ?? 10 }),
        });
        const data = await res.json();
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(data, null, 2) },
          ],
        };
      },
    );

    server.registerTool(
      "wazoo_sparql_query",
      {
        description: "Execute a SPARQL query against a world's RDF graph",
        inputSchema: z.object({
          worldId: z.string().describe("World ID to query"),
          query: z.string().describe("SPARQL query string"),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ worldId, query }) => {
        const token = process.env.WORLDS_TOKEN ?? "";
        const res = await worldsFetch(`/worlds/${worldId}/sparql`, token, {
          method: "POST",
          body: JSON.stringify({ query }),
        });
        const data = await res.json();
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(data, null, 2) },
          ],
        };
      },
    );

    server.registerTool(
      "wazoo_list_worlds",
      {
        description: "List all worlds accessible to the authenticated user",
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async () => {
        const token = process.env.WORLDS_TOKEN ?? "";
        const res = await worldsFetch("/worlds", token);
        const data = await res.json();
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(data, null, 2) },
          ],
        };
      },
    );

    return server;
  }

  const handler = createMcpHandler(buildServer);

  app.all("/mcp", (c) => handler.fetch(c.req.raw));
}
