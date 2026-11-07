import type { Context } from "hono";
import type { AppEnv } from "../../env";
import { createToken, sha256Hex } from "../../lib/crypto";
import { db, id } from "../../lib/db";
import { isAdmin, respond } from "../../lib/http";
import { TOKEN_DEFAULT_SCOPES } from "../../lib/scopes";

function deny(c: Context<AppEnv>, message: string) {
  return respond(c, { error: { code: "PERMISSION_DENIED", message } }, 403);
}

/**
 * A token may not mint a credential more powerful or longer-lived than itself
 * (memory#67). Returns the effective expiry, or a denial message.
 */
export function clampToCaller(
  c: Context<AppEnv>,
  scope: string,
  requestedExpiry: string | undefined,
): { expiresAt: string | null } | { denied: string } {
  const auth = c.get("auth");
  if (isAdmin(c)) return { expiresAt: requestedExpiry ?? null };
  const held = new Set(auth.scope.split(/\s+/).filter(Boolean));
  for (const s of scope.split(/\s+/).filter(Boolean)) {
    if (!held.has(s)) return { denied: `Cannot grant scope not held: ${s}` };
  }
  if (!auth.expiresAt) return { expiresAt: requestedExpiry ?? null };
  const limit = new Date(auth.expiresAt).getTime();
  if (requestedExpiry === undefined) return { expiresAt: auth.expiresAt };
  const asked = new Date(requestedExpiry).getTime();
  if (Number.isNaN(asked) || asked > limit) {
    return { denied: "Cannot outlive the presenting token" };
  }
  return { expiresAt: requestedExpiry };
}

// Omitted scope means the defaults, narrowed to what the caller holds.
function defaultScope(c: Context<AppEnv>): string {
  if (isAdmin(c)) return TOKEN_DEFAULT_SCOPES;
  const held = new Set(c.get("auth").scope.split(/\s+/));
  return TOKEN_DEFAULT_SCOPES.split(" ")
    .filter((s) => held.has(s))
    .join(" ");
}

export async function createPlatformToken(
  c: Context<AppEnv>,
  userUid: string,
  name: string,
  body: { scope?: string; expiresAt?: string },
) {
  const scope = body.scope ?? defaultScope(c);
  if (scope.split(/\s+/).includes("admin")) {
    return deny(c, "Admin tokens must be manually seeded");
  }
  const clamped = clampToCaller(c, scope, body.expiresAt);
  if ("denied" in clamped) return deny(c, clamped.denied);
  const token = createToken("wzp");
  const tokenId = id();
  await db(c.env)
    .prepare(
      "INSERT INTO platform_api_tokens (uid, user_uid, name, token_hash, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(
      tokenId,
      userUid,
      name,
      await sha256Hex(token),
      scope,
      clamped.expiresAt,
    )
    .run();
  return respond(c, { uid: tokenId, name, token }, 201);
}
