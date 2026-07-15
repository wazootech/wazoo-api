import { Hono } from "hono";
import type { AppEnv } from "../env";
import { createToken, sha256Hex } from "../lib/crypto";
import { all, first, id } from "../lib/db";
import { jsonBody, optionalString, requireOrgAccess, requireString, resolveOrg } from "../lib/http";

export const tokens = new Hono<AppEnv>()
  .get("/auth/api-tokens", async (c) => {
    const auth = c.get("auth");
    const rows = auth.organizationId
      ? await all(c.env.DB.prepare("SELECT id, name, scope, last_used_at, expires_at, created_at FROM platform_api_tokens WHERE organization_id = ? ORDER BY created_at DESC").bind(auth.organizationId))
      : await all(c.env.DB.prepare("SELECT id, name, scope, last_used_at, expires_at, created_at FROM platform_api_tokens ORDER BY created_at DESC"));
    return c.json({ tokens: rows });
  })
  .post("/auth/api-tokens/:tokenName", async (c) => {
    const auth = c.get("auth");
    const body = await jsonBody(c).catch(() => ({}));
    const organizationId = auth.organizationId ?? optionalString(body, "organizationId") ?? optionalString(body, "organization");
    if (!organizationId) {
      return c.json({ error: { message: "organizationId or organization is required for unscoped root tokens" } }, 400);
    }
    const organization = await resolveOrg(c, organizationId);
    const token = createToken("wzp");
    const tokenId = id();
    await c.env.DB.prepare("INSERT INTO platform_api_tokens (id, organization_id, name, token_hash, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(tokenId, organization.id, c.req.param("tokenName"), await sha256Hex(token), optionalString(body, "scope") ?? "platform:read platform:write", optionalString(body, "expiresAt"))
      .run();
    return c.json({ id: tokenId, name: c.req.param("tokenName"), token }, 201);
  })
  .delete("/auth/api-tokens/:tokenName", async (c) => {
    const auth = c.get("auth");
    if (auth.organizationId) {
      await c.env.DB.prepare("DELETE FROM platform_api_tokens WHERE organization_id = ? AND name = ?").bind(auth.organizationId, c.req.param("tokenName")).run();
    } else {
      await c.env.DB.prepare("DELETE FROM platform_api_tokens WHERE name = ?").bind(c.req.param("tokenName")).run();
    }
    return c.json({ token: c.req.param("tokenName") });
  })
  .get("/auth/api-tokens/validate", (c) => {
    const auth = c.get("auth");
    return c.json({ exp: auth.expiresAt ? Math.floor(new Date(auth.expiresAt).getTime() / 1000) : 0 });
  })
  .get("/organizations/:organizationId/platform-tokens", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const rows = await all(
      c.env.DB.prepare("SELECT id, organization_id, name, scope, last_used_at, expires_at, created_at FROM platform_api_tokens WHERE organization_id = ? ORDER BY created_at DESC").bind(organization.id)
    );
    return c.json({ tokens: rows });
  })
  .post("/organizations/:organizationId/platform-tokens", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const body = await jsonBody(c);
    const token = createToken("wzp");
    const tokenId = id();
    await c.env.DB.prepare(
      "INSERT INTO platform_api_tokens (id, organization_id, name, token_hash, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(tokenId, organization.id, requireString(body, "name"), await sha256Hex(token), optionalString(body, "scope") ?? "platform:read platform:write", optionalString(body, "expiresAt"))
      .run();
    return c.json({ id: tokenId, token }, 201);
  })
  .delete("/organizations/:organizationId/platform-tokens/:tokenId", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    await c.env.DB.prepare("DELETE FROM platform_api_tokens WHERE organization_id = ? AND id = ?").bind(organization.id, c.req.param("tokenId")).run();
    return c.body(null, 204);
  })
  .get("/organizations/:organizationId/worlds/:worldId/auth/tokens", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const world = await first<{ id: string; organization_id: string }>(c.env.DB.prepare("SELECT id, organization_id FROM worlds WHERE organization_id = ? AND slug = ?").bind(organization.id, worldId));
    if (!world) return c.notFound();
    const rows = await all(
      c.env.DB.prepare("SELECT id, world_id, name, last_used_at, expires_at, created_at FROM world_auth_tokens WHERE world_id = ? ORDER BY created_at DESC").bind(world.id)
    );
    return c.json({ tokens: rows });
  })
  .post("/organizations/:organizationId/worlds/:worldId/auth/tokens", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const world = await first<{ id: string; organization_id: string }>(c.env.DB.prepare("SELECT id, organization_id FROM worlds WHERE organization_id = ? AND slug = ?").bind(organization.id, worldId));
    if (!world) return c.notFound();
    const body = await jsonBody(c).catch(() => ({}));
    const token = createToken("wzw");
    const tokenId = id();
    await c.env.DB.prepare("INSERT INTO world_auth_tokens (id, world_id, name, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)")
      .bind(tokenId, world.id, optionalString(body, "name") ?? "default", await sha256Hex(token), optionalString(body, "expiresAt"))
      .run();
    return c.json({ id: tokenId, token }, 201);
  })
  .post("/organizations/:organizationId/worlds/:worldId/auth/rotate", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const world = await first<{ id: string }>(c.env.DB.prepare("SELECT id FROM worlds WHERE organization_id = ? AND slug = ?").bind(organization.id, worldId));
    if (!world) return c.notFound();
    await c.env.DB.prepare("DELETE FROM world_auth_tokens WHERE world_id = ?").bind(world.id).run();
    return c.body(null, 204);
  })
  .delete("/organizations/:organizationId/worlds/:worldId/auth/tokens/:tokenId", async (c) => {
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const worldId = c.req.param("worldId");
    const world = await first<{ id: string }>(c.env.DB.prepare("SELECT id FROM worlds WHERE organization_id = ? AND slug = ?").bind(organization.id, worldId));
    if (!world) return c.notFound();
    await c.env.DB.prepare("DELETE FROM world_auth_tokens WHERE world_id = ? AND id = ?").bind(world.id, c.req.param("tokenId")).run();
    return c.body(null, 204);
  });
