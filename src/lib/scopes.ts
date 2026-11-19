/**
 * Scope constants for platform API tokens.
 *
 * Kept in one place so session minting and token defaults cannot drift apart
 * (the root cause of wazoo-api#13 / wazoo-api#14).
 */

/**
 * Scope set granted to console session tokens minted by the auth routes
 * (`POST /v1/auth/workos` and the verify/login minting path).
 *
 * Deliberately includes `users.write`: the console must create and revoke
 * API tokens on the user's behalf. This is bounded — user-bound tokens are
 * confined to their own user by `requireUserAccess`, so a session token can
 * only manage tokens for its own user, not other users.
 */
export const SESSION_DEFAULT_SCOPES =
  "users.read users.write worlds.read worlds.write usage.read billing.read";

/**
 * Default scope set applied to newly created API tokens when the caller
 * omits the `scope` field. Kept narrower than session scopes: a fresh token
 * cannot manage other tokens unless the creator explicitly requests
 * `users.write`.
 */
export const TOKEN_DEFAULT_SCOPES =
  "users.read worlds.read worlds.write usage.read billing.read";

/**
 * Scope string attached to the env-configured `WAZOO_PLATFORM_ADMIN_TOKEN`.
 *
 * There is intentionally no `worlds.admin` scope: it was granted here and in
 * docs but never enforced by any route (wazoo-api#78). World privileges are
 * `worlds.read` / `worlds.write`; platform-wide privilege is `admin`, which
 * `isAdmin()` additionally binds to an ADMIN-kind, user-less token.
 */
export const ENV_ADMIN_TOKEN_SCOPES =
  "admin users.read users.write worlds.read worlds.write usage.read billing.read";

/**
 * World-token scopes issuable through /v1/worlds/{id}/auth/tokens
 * (wazoo-api#21). These are the data-plane scopes worlds-api enforces on
 * wzw_ keys; they are deliberately disjoint from the platform scopes above.
 */
export const WORLD_TOKEN_ALLOWED_SCOPES = ["data:read", "data:write"] as const;

/**
 * Scope set applied when the caller omits `scopes` on world-token creation.
 *
 * Fail-closed on purpose: read-only, and narrower than worlds-api's own
 * default (["data:read", "data:write"]), which previously applied silently
 * because the route never sent a scopes decision. Callers that need write
 * access must ask for it explicitly. `embeddings:admin` is not in the
 * allowed set: managing the namespace embedding credential is not granted
 * through the user-facing issuance surface.
 */
export const WORLD_TOKEN_DEFAULT_SCOPES: (
  "data:read" | "data:write" | "embeddings:admin"
)[] = ["data:read"];
