// Platform-token routes for the script mock server (wazoo-api#149). Mint
// enforces the wazoo-api#154 clamp: a limited token may not mint broader scope
// or longer expiry, which the smoke gate asserts.
import { isAdmin, resolveCaller, userFor } from "./state.mjs";

export function platformTokenRoutes(state) {
  return [
    {
      method: "POST",
      plane: "api",
      pattern: /^\/v1\/auth\/api-tokens$/,
      handle: ({ token, body }) => {
        if (!token) return { status: 401, json: { error: "unauthenticated" } };
        const caller = resolveCaller(state, token);
        if (caller.kind === "admin")
          return mint(state, body?.email ?? "", body);
        if (caller.kind !== "platform")
          return { status: 401, json: { error: "invalid token" } };
        if (clamped(caller.record, body))
          return { status: 403, json: { error: "token mint clamped" } };
        return mint(state, caller.record.email, body);
      },
    },
    {
      method: "DELETE",
      plane: "api",
      pattern: /^\/v1\/auth\/api-tokens\/([^/]+)$/,
      handle: ({ token, url }, match) => {
        if (!token || !isAdmin(state, token))
          return { status: 401, json: { error: "invalid token" } };
        const email = url.searchParams.get("email");
        for (const [value, record] of state.platformTokens)
          if (record.name === match[1] && record.email === email) {
            state.platformTokens.delete(value);
            return { status: 204, text: "" };
          }
        return { status: 404, json: { error: "not found" } };
      },
    },
    {
      method: "GET",
      plane: "api",
      pattern: /^\/v1\/auth\/api-tokens$/,
      handle: ({ token }) => {
        if (!token || !isAdmin(state, token))
          return { status: 401, json: { error: "invalid token" } };
        return {
          status: 200,
          json: {
            tokens: [...state.platformTokens.values()].map((record) => ({
              uid: record.uid,
              name: record.name,
            })),
          },
        };
      },
    },
    {
      method: "GET",
      plane: "api",
      pattern: /^\/v1\/auth\/api-tokens\/validate$/,
      handle: ({ token }) => {
        if (!token || !isAdmin(state, token))
          return { status: 401, json: { error: "invalid token" } };
        return { status: 200, json: { exp: 1893456000 } };
      },
    },
  ];
}

function mint(state, email, body) {
  const token = `wzp_mock${state.nextSeq("tokens")}`;
  const uid = `pt-${state.nextSeq("tokens")}`;
  state.platformTokens.set(token, {
    uid,
    userUid: userFor(state, email).uid,
    name: body?.tokenName ?? "",
    scope: body?.scope ?? "",
    expiresAt: body?.expiresAt ?? null,
    email,
  });
  return { status: 201, json: { token: { token, uid } } };
}

function clamped(parent, body) {
  const scope = new Set(String(body?.scope ?? "").split(/\s+/).filter(Boolean));
  const parentScope = new Set(
    String(parent.scope ?? "").split(/\s+/).filter(Boolean),
  );
  const wider = [...scope].some((s) => !parentScope.has(s));
  const longer =
    body?.expiresAt &&
    parent.expiresAt &&
    String(body.expiresAt) > String(parent.expiresAt);
  return wider || longer;
}
