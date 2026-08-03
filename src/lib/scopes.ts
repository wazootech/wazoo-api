/**
 * Scope constants for platform API tokens.
 *
 * Kept in one place so session minting and token defaults cannot drift apart
 * (the root cause of wazoo-api#13 / wazoo-api#14).
 */

/**
 * Scope set granted to console session tokens minted by the auth routes
 * (`POST /v1/auth/workos-session` and the verify/login minting path).
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
