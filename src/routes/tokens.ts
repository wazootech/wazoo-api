import { Hono } from "hono";
import type { AppEnv } from "../env";
import { createToken, sha256Hex } from "../lib/crypto";
import { all, db, first, id } from "../lib/db";
import { jsonBody, optionalString, requireScope, requireString, resolveOrg } from "../lib/http";
import { quotaError, quotaStatus } from "../lib/quota";

const defaultPlatformScopes = "organizations.read organizations.write worlds.read worlds.write usage.read billing.read";

export const tokens = new Hono<AppEnv>()
  .get("/auth/api-tokens", async (c) => {
    requireScope(c, "organizations.read");
    const auth = c.get("auth");
    const database = db(c.env);
    const rows = auth.organizationId
      ? await all(database.prepare("SELECT id, name, scope, last_used_at, expires_at, created_at FROM platform_api_tokens WHERE organization_id = ? AND kind != 'ADMIN' ORDER BY created_at DESC").bind(auth.organizationId))
      : await all(database.prepare("SELECT id, name, scope, last_used_at, expires_at, created_at FROM platform_api_tokens WHERE kind != 'ADMIN' ORDER BY created_at DESC"));
    return c.json({ tokens: rows });
  })
  .post("/auth/api-tokens/:tokenName", async (c) => {
    requireScope(c, "organizations.write");
    const auth = c.get("auth");
    const body = await jsonBody(c).catch(() => ({}));
    const organizationId = auth.organizationId ?? optionalString(body, "organizationId") ?? optionalString(body, "organization");
    if (!organizationId) {
      return c.json({ error: { code: "INVALID_ARGUMENT", message: "organizationId or organization is required for unscoped root tokens" } }, 400);
    }
    const organization = await resolveOrg(c, organizationId);
    const scope = optionalString(body, "scope") ?? defaultPlatformScopes;
    if (scope.split(/\s+/).includes("admin")) {
      return c.json({ error: { code: "PERMISSION_DENIED", message: "Admin tokens must be manually seeded" } }, 403);
    }
    const token = createToken("wzp");
    const tokenId = id();
    await db(c.env).prepare("INSERT INTO platform_api_tokens (id, organization_id, name, token_hash, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(tokenId, organization.id, c.req.param("tokenName"), await sha256Hex(token), scope, optionalString(body, "expiresAt"))
      .run();
    return c.json({ id: tokenId, name: c.req.param("tokenName"), token }, 201);
  })
  .delete("/auth/api-tokens/:tokenName", async (c) => {
    requireScope(c, "organizations.write");
    const auth = c.get("auth");
    if (auth.organizationId) {
      await db(c.env).prepare("DELETE FROM platform_api_tokens WHERE organization_id = ? AND name = ? AND kind != 'ADMIN'").bind(auth.organizationId, c.req.param("tokenName")).run();
    } else {
      await db(c.env).prepare("DELETE FROM platform_api_tokens WHERE name = ? AND kind != 'ADMIN'").bind(c.req.param("tokenName")).run();
    }
    return c.json({ token: c.req.param("tokenName") });
  })
  .get("/auth/api-tokens/validate", (c) => {
    const auth = c.get("auth");
    return c.json({ exp: auth.expiresAt ? Math.floor(new Date(auth.expiresAt).getTime() / 1000) : 0 });
  })
  .get("/organizations/:organizationId/platform-tokens", async (c) => {
    requireScope(c, "organizations.read");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const rows = await all(
      db(c.env).prepare("SELECT id, organization_id, name, scope, last_used_at, expires_at, created_at FROM platform_api_tokens WHERE organization_id = ? AND kind != 'ADMIN' ORDER BY created_at DESC").bind(organization.id)
    );
    return c.json({ tokens: rows });
  })
  .post("/organizations/:organizationId/platform-tokens", async (c) => {
    requireScope(c, "organizations.write");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const body = await jsonBody(c);
    const scope = optionalString(body, "scope") ?? defaultPlatformScopes;
    if (scope.split(/\s+/).includes("admin")) {
      return c.json({ error: { code: "PERMISSION_DENIED", message: "Admin tokens must be manually seeded" } }, 403);
    }
    const token = createToken("wzp");
    const tokenId = id();
    await db(c.env).prepare(
      "INSERT INTO platform_api_tokens (id, organization_id, name, token_hash, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(tokenId, organization.id, requireString(body, "name"), await sha256Hex(token), scope, optionalString(body, "expiresAt"))
      .run();
    return c.json({ id: tokenId, token }, 201);
  })
  .delete("/organizations/:organizationId/platform-tokens/:tokenId", async (c) => {
    requireScope(c, "organizations.write");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    await db(c.env).prepare("DELETE FROM platform_api_tokens WHERE organization_id = ? AND id = ? AND kind != 'ADMIN'").bind(organization.id, c.req.param("tokenId")).run();
    return c.body(null, 204);
  })
  .get("/organizations/:organizationId/worlds/:worldId/auth/tokens", async (c) => {
    requireScope(c, "worlds.admin");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const quota = await quotaStatus(c, organization.id, organization.state);
    if (quota.state === "SUSPENDED") return quotaError(c, "Organization is suspended; new world tokens cannot be created", quota);
    if (quota.state === "THROTTLED") return quotaError(c, "Organization is throttled; new world tokens cannot be created", quota);
    const worldId = c.req.param("worldId");
    const world = await first<{ id: string; organization_id: string }>(db(c.env).prepare("SELECT id, organization_id FROM worlds WHERE organization_id = ? AND slug = ?").bind(organization.id, worldId));
    if (!world) return c.notFound();
    const rows = await all(
      db(c.env).prepare("SELECT id, world_id, name, last_used_at, expires_at, created_at FROM world_auth_tokens WHERE world_id = ? ORDER BY created_at DESC").bind(world.id)
    );
    return c.json({ tokens: rows });
  })
  .post("/organizations/:organizationId/worlds/:worldId/auth/tokens", async (c) => {
    requireScope(c, "worlds.admin");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const world = await first<{ id: string; organization_id: string }>(db(c.env).prepare("SELECT id, organization_id FROM worlds WHERE organization_id = ? AND slug = ?").bind(organization.id, worldId));
    if (!world) return c.notFound();
    const body = await jsonBody(c).catch(() => ({}));
    const token = createToken("wzw");
    const tokenId = id();
    await db(c.env).prepare("INSERT INTO world_auth_tokens (id, world_id, name, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)")
      .bind(tokenId, world.id, optionalString(body, "name") ?? "default", await sha256Hex(token), optionalString(body, "expiresAt"))
      .run();
    return c.json({ id: tokenId, token }, 201);
  })
  .post("/organizations/:organizationId/worlds/:worldId/auth/rotate", async (c) => {
    requireScope(c, "worlds.admin");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const world = await first<{ id: string }>(db(c.env).prepare("SELECT id FROM worlds WHERE organization_id = ? AND slug = ?").bind(organization.id, worldId));
    if (!world) return c.notFound();
    await db(c.env).prepare("DELETE FROM world_auth_tokens WHERE world_id = ?").bind(world.id).run();
    return c.body(null, 204);
  })
  .delete("/organizations/:organizationId/worlds/:worldId/auth/tokens/:tokenId", async (c) => {
    requireScope(c, "worlds.admin");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const world = await first<{ id: string }>(db(c.env).prepare("SELECT id FROM worlds WHERE organization_id = ? AND slug = ?").bind(organization.id, worldId));
    if (!world) return c.notFound();
    await db(c.env).prepare("DELETE FROM world_auth_tokens WHERE world_id = ? AND id = ?").bind(world.id, c.req.param("tokenId")).run();
    return c.body(null, 204);
  });
