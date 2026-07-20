import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../env";
import { db, userByIdentifier } from "./db";

export function respond(
  c: Context<AppEnv>,
  data: unknown,
  status?: ContentfulStatusCode,
) {
  return c.json(data, status as any) as any;
}

export function ok(
  c: Context<AppEnv>,
  data: unknown,
  status: ContentfulStatusCode = 200,
) {
  return respond(c, { data }, status);
}

export function created(c: Context<AppEnv>, data: unknown) {
  return ok(c, data, 201);
}

export async function notFound() {
  throw new HTTPException(404, { message: "Not found" });
}

export async function errorHandler(error: Error, c: Context<AppEnv>) {
  if (error instanceof HTTPException) {
    return c.json(
      { error: { code: errorCode(error.status), message: error.message } },
      error.status,
    );
  }

  if (error instanceof SyntaxError) {
    return c.json(
      { error: { code: "INVALID_ARGUMENT", message: "Invalid JSON body" } },
      400,
    );
  }

  console.error(
    JSON.stringify({
      level: "error",
      message: error.message,
      stack: error.stack,
    }),
  );
  return c.json(
    { error: { code: "INTERNAL", message: "Internal server error" } },
    500,
  );
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
  const row = await database
    .prepare(
      "SELECT uid, user_uid, scope, kind, expires_at FROM platform_api_tokens WHERE token_hash = ? AND (expires_at IS NULL OR expires_at > ?)",
    )
    .bind(hash, new Date().toISOString())
    .first<{
      uid: string;
      user_uid: string | null;
      scope: string;
      kind: "USER" | "ADMIN" | null;
      expires_at: string | null;
    }>();

  if (!row) {
    throw new HTTPException(401, { message: "Invalid platform API token" });
  }

  c.set("auth", {
    tokenId: row.uid,
    userUid: row.user_uid,
    scope: row.scope,
    kind: row.kind ?? "USER",
    expiresAt: row.expires_at,
  });
  c.executionCtx.waitUntil(
    database
      .prepare("UPDATE platform_api_tokens SET last_used_at = ? WHERE uid = ?")
      .bind(new Date().toISOString(), row.uid)
      .run(),
  );
  await next();
}

export function requireUserAccess(c: Context<AppEnv>, userUid: string) {
  const auth = c.get("auth");
  if (isAdmin(c)) return;
  if (auth.kind === "ADMIN") {
    throw new HTTPException(403, { message: "Invalid admin token shape" });
  }
  if (auth.userUid !== userUid) {
    throw new HTTPException(403, {
      message: "Token cannot access this user",
    });
  }
}

export function isAdmin(c: Context<AppEnv>): boolean {
  const auth = c.get("auth");
  return (
    auth.kind === "ADMIN" &&
    auth.scope.split(/\s+/).includes("admin") &&
    auth.userUid === null
  );
}

export function requireScope(c: Context<AppEnv>, scope: string) {
  if (scope === "admin") {
    if (!isAdmin(c))
      throw new HTTPException(403, {
        message: "Missing required scope: admin",
      });
    return;
  }
  const scopes = new Set(c.get("auth").scope.split(/\s+/).filter(Boolean));
  if (!scopes.has(scope) && !isAdmin(c)) {
    throw new HTTPException(403, {
      message: `Missing required scope: ${scope}`,
    });
  }
}

export async function resolveUser(c: Context<AppEnv>, identifier?: string) {
  const auth = c.get("auth");
  const user = auth.userUid
    ? await userByIdentifier(db(c.env), auth.userUid)
    : identifier
      ? await userByIdentifier(db(c.env), identifier)
      : null;
  if (!user) {
    throw new HTTPException(404, { message: "User not found" });
  }
  requireUserAccess(c, user.uid);
  return user;
}
