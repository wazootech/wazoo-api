// Control-plane (wazoo-api) identity and world-list routes for the script mock
// server (wazoo-api#149). Statuses mirror the real contract closely enough
// that every assertion the scripts make passes for the right reason.
import { createWorld, isAdmin, resolveCaller, userFor } from "./state.mjs";

export const OPENAPI = {
  openapi: "3.1.0",
  paths: { "/health": {}, "/ready": {}, "/v1/worlds": {}, "/v1/users/me": {} },
  info: { title: "Wazoo API (mock)", version: "0.0.0" },
};

export function healthRoutes() {
  return [
    {
      method: "GET",
      plane: "api",
      pattern: /^\/(ready|health|openapi\.json)$/,
      handle: ({ url }) =>
        url.pathname === "/ready"
          ? { status: 200, json: { status: "ready" } }
          : url.pathname === "/health"
            ? { status: 200, json: { status: "ok" } }
            : { status: 200, json: OPENAPI },
    },
  ];
}

export function identityRoutes(state) {
  return [
    {
      method: "GET",
      plane: "api",
      pattern: /^\/v1\/users\/me$/,
      handle: ({ url, token }) => {
        if (!token) return { status: 401, json: { error: "unauthenticated" } };
        const email = url.searchParams.get("email");
        if (!email) return { status: 400, json: { error: "email required" } };
        if (!isAdmin(state, token) && !state.platformTokens.has(token))
          return { status: 401, json: { error: "invalid token" } };
        const user = userFor(state, email);
        return { status: 200, json: { user: { uid: user.uid, email } } };
      },
    },
  ];
}

export function worldListRoutes(state) {
  return [
    {
      method: "POST",
      plane: "api",
      pattern: /^\/v1\/worlds$/,
      handle: ({ token, body }) => {
        if (!token) return { status: 401, json: { error: "unauthenticated" } };
        const caller = resolveCaller(state, token);
        if (caller.kind === "unknown" || caller.kind === "world")
          return { status: 401, json: { error: "invalid token" } };
        if (!body || typeof body !== "object")
          return { status: 400, json: { error: "body required" } };
        if ("worldId" in body)
          return { status: 400, json: { error: "worldId is server-assigned" } };
        const ownerEmail =
          caller.kind === "admin" ? body.ownerEmail : caller.record.email;
        const owner = userFor(state, ownerEmail ?? "");
        const world = createWorld(state, {
          ownerUid: owner.uid,
          ownerEmail: owner.email,
          displayName: body.displayName ?? "",
        });
        return {
          status: 201,
          json: {
            world: { id: world.id, displayName: world.displayName, state: world.state },
          },
        };
      },
    },
    {
      method: "GET",
      plane: "api",
      pattern: /^\/v1\/worlds$/,
      handle: ({ url, token }) => {
        if (!token) return { status: 401, json: { error: "unauthenticated" } };
        const caller = resolveCaller(state, token);
        if (caller.kind !== "admin" && caller.kind !== "platform")
          return { status: 401, json: { error: "invalid token" } };
        const email = url.searchParams.get("email");
        const visible = [...state.worlds.values()].filter((world) =>
          caller.kind === "admin"
            ? email === null || world.ownerEmail === email
            : world.ownerUid === caller.record.userUid,
        );
        return {
          status: 200,
          json: {
            worlds: visible.map((world) => ({
              id: world.id,
              displayName: world.displayName,
              state: world.state,
            })),
          },
        };
      },
    },
  ];
}
