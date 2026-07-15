import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../env";
import { db, organizationByIdentifier } from "./db";

export type JsonObject = Record<string, unknown>;

export function ok(c: Context<AppEnv>, data: unknown, status: ContentfulStatusCode = 200) {
  return c.json({ data }, status);
}

export function created(c: Context<AppEnv>, data: unknown) {
  return ok(c, data, 201);
}

export async function jsonBody<T extends JsonObject>(c: Context<AppEnv>): Promise<T> {
  try {
    const body = await c.req.json<T>();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HTTPException(400, { message: "Expected a JSON object" });
    }
    return body;
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(400, { message: "Invalid JSON body" });
  }
}

export function requireString(body: JsonObject, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new HTTPException(400, { message: `Missing required string: ${key}` });
  }
  return value.trim();
}

export function requireResourceId(body: JsonObject, key: string): string {
  const value = requireString(body, key);
  if (!/^[a-z][a-z0-9-]{2,62}$/.test(value)) {
    throw new HTTPException(400, { message: `${key} must match ^[a-z][a-z0-9-]{2,62}$` });
  }
  return value;
}

export function optionalString(body: JsonObject, key: string): string | null {
  const value = body[key];
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new HTTPException(400, { message: `Expected string: ${key}` });
  }
  return value.trim() || null;
}

export async function notFound() {
  throw new HTTPException(404, { message: "Not found" });
}

export async function errorHandler(error: Error, c: Context<AppEnv>) {
  if (error instanceof HTTPException) {
    return c.json({ error: { code: errorCode(error.status), message: error.message } }, error.status);
  }

  console.error(JSON.stringify({ level: "error", message: error.message, stack: error.stack }));
  return c.json({ error: { code: "INTERNAL", message: "Internal server error" } }, 500);
}

function errorCode(status: number): string {
  if (status === 400) return "INVALID_ARGUMENT";
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "PERMISSION_DENIED";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "ALREADY_EXISTS";
  if (status === 429) return "RESOURCE_EXHAUSTED";
  return "UNKNOWN";
}

export async function requireAuth(c: Context<AppEnv>, next: Next) {
  const header = c.req.header("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token?.startsWith("wzp_")) {
    throw new HTTPException(401, { message: "Missing platform API token" });
  }

  const { sha256Hex } = await import("./crypto");
  const hash = await sha256Hex(token);
  const database = db(c.env);
  const row = await database.prepare(
    "SELECT id, organization_id, scope, kind, expires_at FROM platform_api_tokens WHERE token_hash = ? AND (expires_at IS NULL OR expires_at > ?)"
  )
    .bind(hash, new Date().toISOString())
    .first<{ id: string; organization_id: string | null; scope: string; kind: "ORGANIZATION" | "ADMIN" | null; expires_at: string | null }>();

  if (!row) {
    throw new HTTPException(401, { message: "Invalid platform API token" });
  }

  c.set("auth", { tokenId: row.id, organizationId: row.organization_id, scope: row.scope, kind: row.kind ?? "ORGANIZATION", expiresAt: row.expires_at });
  c.executionCtx.waitUntil(
    database.prepare("UPDATE platform_api_tokens SET last_used_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), row.id)
      .run()
  );
  await next();
}

export function requireOrgAccess(c: Context<AppEnv>, organizationId: string) {
  const auth = c.get("auth");
  if (auth.kind === "ADMIN") return;
  if (auth.organizationId && auth.organizationId !== organizationId) {
    throw new HTTPException(403, { message: "Token cannot access this organization" });
  }
}

export function isAdmin(c: Context<AppEnv>): boolean {
  const auth = c.get("auth");
  return auth.kind === "ADMIN" && auth.scope.split(/\s+/).includes("admin") && auth.organizationId === null;
}

export function requireScope(c: Context<AppEnv>, scope: string) {
  const scopes = new Set(c.get("auth").scope.split(/\s+/).filter(Boolean));
  if (!scopes.has(scope) && !isAdmin(c)) {
    throw new HTTPException(403, { message: `Missing required scope: ${scope}` });
  }
}

export async function resolveOrg(c: Context<AppEnv>, identifier: string) {
  const organization = await organizationByIdentifier(db(c.env), identifier);
  if (!organization) {
    throw new HTTPException(404, { message: "Organization not found" });
  }
  requireOrgAccess(c, organization.id);
  return organization;
}
