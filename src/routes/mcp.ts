import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../env";
import {
  runListWorlds,
  runSearchWorlds,
  runSparqlQuery,
  type McpDeps,
} from "../lib/mcp-worlds";
import { requireScope } from "../lib/http";
import * as z from "zod/v4";

/**
 * Register the MCP endpoint at /mcp.
 *
 * Streamable-HTTP MCP server that proxies read-only data-plane operations
 * through the worlds-api. Auth reuses the existing bearer platform token
 * (requireAuth middleware in src/index.ts) and every world-scoped call is
 * bound to the caller's own worlds (memory#73 / #159):
 *
 * - The caller's worldId is resolved against the control-plane `worlds`
 *   table for the authenticated user before any data-plane call. Not-owned
 *   looks like not-found.
 * - Data-plane credentials are minted per call through the same namespace
 *   path as /v1/worlds/{id}/auth/tokens (namespace = user uid, worldId
 *   bound) and revoked after use. There is no process-wide WORLDS_TOKEN.
 * - wazoo_list_worlds is served from the control plane, never the data
 *   plane, so a broad credential can never list other users' worlds.
 *
 * Tool surface v0:
 * - wazoo_search_worlds: hybrid search across a world's graph
 * - wazoo_sparql_query: run a SPARQL query against a world
 * - wazoo_list_worlds: list all worlds for the authenticated user
 */

function toolResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

function buildServer(deps: McpDeps): McpServer {
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
      try {
        return toolResult(
          await runSearchWorlds(deps, { worldId, query, limit }),
        );
      } catch (error) {
        return toolError(error);
      }
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
      try {
        return toolResult(await runSparqlQuery(deps, { worldId, query }));
      } catch (error) {
        return toolError(error);
      }
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
      try {
        return toolResult(await runListWorlds(deps));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}

export function registerMcpRoute(app: OpenAPIHono<AppEnv>) {
  app.all("/mcp", (c: Context<AppEnv>) => {
    // requireAuth middleware normally populates this; keep the in-route check
    // so the endpoint fails closed even where the middleware is not mounted.
    const auth = c.get("auth");
    if (!auth) {
      throw new HTTPException(401, { message: "Missing platform API token" });
    }
    requireScope(c, "worlds.read");
    // World scoping needs a user identity; admin tokens have none.
    if (!auth.userUid) {
      throw new HTTPException(403, {
        message: "MCP tools require a user platform token",
      });
    }
    const userUid: string = auth.userUid;
    const handler = createMcpHandler(() =>
      buildServer({
        env: c.env,
        userUid,
        waitUntil: (promise: Promise<unknown>) =>
          c.executionCtx.waitUntil(promise),
      }),
    );
    return handler.fetch(c.req.raw);
  });
}
