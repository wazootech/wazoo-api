import type { AppEnv } from "../env";
import { db, first } from "./db";
import { createApiKey, deleteApiKey } from "@worlds/client";
import { worldsAdminClient, worldsApiErrorDetail } from "./worlds-client";
import { worldResource, type WorldRow } from "../routes/worlds/shared";

/**
 * World-scoped tool backends for the /mcp route (wazoo-api#159).
 *
 * Every world-scoped call resolves worldId against the control-plane
 * `worlds` table for the authenticated user before any data-plane call
 * (same predicate as /v1/worlds/{worldId}; not-owned looks like
 * not-found). Data-plane credentials are minted per call through the
 * same namespace path as /v1/worlds/{id}/auth/tokens (namespace = user
 * uid, worldId bound) and revoked after use; there is no process-wide
 * WORLDS_TOKEN. runListWorlds reads the control plane, never the data
 * plane, so a broad credential can never list other users' worlds.
 */

export interface McpDeps {
  env: AppEnv["Bindings"];
  userUid: string;
  waitUntil: (promise: Promise<unknown>) => void;
}

async function ownedWorld(
  env: AppEnv["Bindings"],
  userUid: string,
  worldId: string,
): Promise<WorldRow | null> {
  // Same predicate as /v1/worlds/{worldId} (worlds/shared.ts worldForUser):
  // every worlds query carries user_uid; a valid worldId alone grants nothing.
  return first<WorldRow>(
    db(env)
      .prepare("SELECT * FROM worlds WHERE user_uid = ? AND world_id = ?")
      .bind(userUid, worldId),
  );
}

/**
 * scopedWorldCredential mints a one-time data-plane key bound to the
 * caller's namespace and the (already ownership-checked) world, and
 * schedules its revocation after the call completes.
 */
async function scopedWorldCredential(
  deps: McpDeps,
  worldId: string,
): Promise<string> {
  const res = await createApiKey({
    client: worldsAdminClient(deps.env),
    body: { namespace: deps.userUid, worldId, name: "mcp" },
  });
  if (res.error || !res.data?.token) {
    throw worldsApiToolError(res, "Failed to mint a world-scoped credential");
  }
  const keyUid = res.data.uid;
  if (keyUid) {
    deps.waitUntil(
      deleteApiKey({
        client: worldsAdminClient(deps.env),
        path: { keyId: keyUid },
      }).then(
        () => undefined,
        () => undefined,
      ),
    );
  }
  return res.data.token;
}

interface WorldsApiFailure {
  error?: unknown;
  response?: Response;
}

function worldsApiToolError(res: WorldsApiFailure, fallback: string): Error {
  const detail = worldsApiErrorDetail(res);
  return new Error(`${fallback}: ${detail.code} ${detail.message}`);
}

export async function runSearchWorlds(
  deps: McpDeps,
  args: { worldId: string; query: string; limit?: number },
): Promise<unknown> {
  const world = await ownedWorld(deps.env, deps.userUid, args.worldId);
  if (!world) throw new Error("World not found");
  const token = await scopedWorldCredential(deps, world.world_id);
  const res = await fetch(
    `${deps.env.WORLDS_API_URL.replace(/\/+$/, "")}/worlds/${world.world_id}/search`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query: args.query, limit: args.limit ?? 10 }),
    },
  );
  return res.json();
}

export async function runSparqlQuery(
  deps: McpDeps,
  args: { worldId: string; query: string },
): Promise<unknown> {
  const world = await ownedWorld(deps.env, deps.userUid, args.worldId);
  if (!world) throw new Error("World not found");
  const token = await scopedWorldCredential(deps, world.world_id);
  const res = await fetch(
    `${deps.env.WORLDS_API_URL.replace(/\/+$/, "")}/worlds/${world.world_id}/sparql`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query: args.query }),
    },
  );
  return res.json();
}

export async function runListWorlds(deps: McpDeps): Promise<unknown> {
  // Control-plane list, scoped to the caller (memory#159): the data-plane
  // GET /worlds with a broad key would list every user's worlds.
  const rows = await db(deps.env)
    .prepare(
      "SELECT * FROM worlds WHERE user_uid = ? AND state != 'deleted' ORDER BY create_time DESC",
    )
    .bind(deps.userUid)
    .all<WorldRow>();
  return { worlds: (rows.results ?? []).map(worldResource) };
}
