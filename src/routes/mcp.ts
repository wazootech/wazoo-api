import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { all, db, first } from "../lib/db";
import { isAdmin, requireScope } from "../lib/http";
import { resourceId } from "../lib/schemas";
import * as z from "zod/v4";

type McpAccess = {
  env: AppEnv["Bindings"];
  userId: string | null;
  admin: boolean;
};

type WorldRow = {
  world_id: string;
  display_name: string;
  state: string;
};

export async function canReadWorld(
  access: McpAccess,
  worldId: string,
): Promise<boolean> {
  if (!resourceId.safeParse(worldId).success) return false;
  if (access.admin) return true;
  if (!access.userId) return false;
  const row = await first<{ world_id: string }>(
    db(access.env)
      .prepare(
        "SELECT world_id FROM worlds WHERE user_id = ? AND world_id = ? AND state != 'deleted'",
      )
      .bind(access.userId, worldId),
  );
  return row !== null;
}

function denied() {
  return {
    isError: true,
    content: [
      { type: "text" as const, text: "World not found or not accessible" },
    ],
  };
}

async function worldsFetch(
  access: McpAccess,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${access.env.WORLDS_API_URL.replace(/\/+$/, "")}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${access.env.WORLDS_API_ADMIN_KEY}`,
      ...init?.headers,
    },
  });
}

function buildServer(access: McpAccess): McpServer {
  const server = new McpServer({ name: "wazoo", version: "0.1.0" });

  server.registerTool(
    "wazoo_search_worlds",
    {
      description:
        "Search across world graphs using hybrid vector + pattern matching",
      inputSchema: z.object({
        worldId: resourceId.describe("World ID to search"),
        query: z.string().describe("Search query"),
        limit: z.number().optional().describe("Max results (default 10)"),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ worldId, query, limit }) => {
      if (!(await canReadWorld(access, worldId))) return denied();
      const res = await worldsFetch(
        access,
        `/worlds/${encodeURIComponent(worldId)}/search`,
        {
          method: "POST",
          body: JSON.stringify({ query, limit: limit ?? 10 }),
        },
      );
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
        worldId: resourceId.describe("World ID to query"),
        query: z.string().describe("SPARQL query string"),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ worldId, query }) => {
      if (!(await canReadWorld(access, worldId))) return denied();
      const res = await worldsFetch(
        access,
        `/worlds/${encodeURIComponent(worldId)}/sparql`,
        {
          method: "POST",
          body: JSON.stringify({ query }),
        },
      );
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
      const statement = access.admin
        ? db(access.env).prepare(
            "SELECT world_id, display_name, state FROM worlds WHERE state != 'deleted' ORDER BY create_time DESC",
          )
        : db(access.env)
            .prepare(
              "SELECT world_id, display_name, state FROM worlds WHERE user_id = ? AND state != 'deleted' ORDER BY create_time DESC",
            )
            .bind(access.userId);
      const worlds = await all<WorldRow>(statement);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                worlds: worlds.map((world) => ({
                  id: world.world_id,
                  displayName: world.display_name,
                  state: world.state,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  return server;
}

export function registerMcpRoute(app: OpenAPIHono<AppEnv>) {
  app.all("/mcp", async (c) => {
    requireScope(c, "worlds.read");
    const access: McpAccess = {
      env: c.env,
      userId: c.get("auth").userId,
      admin: isAdmin(c),
    };
    return createMcpHandler(() => buildServer(access)).fetch(c.req.raw);
  });
}
