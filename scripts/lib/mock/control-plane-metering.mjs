// World metering (usage/limits/billing) and embedding-credential routes for
// the script mock server (wazoo-api#149). The credential toggle drives the
// data plane's keyword/hybrid search modes.
import { ownedWorld } from "./access.mjs";
import { resolveCaller } from "./state.mjs";

export function meteringRoutes(state) {
  const owned = (token, id) => ownedWorld(state, token, id)?.world ?? null;
  return [
    {
      method: "POST",
      plane: "api",
      pattern: /^\/v1\/worlds\/([^/]+)\/usage$/,
      handle: (request, match) =>
        owned(request.token, match[1])
          ? { status: 200, json: { recorded: true } }
          : { status: 404, json: { error: "not found" } },
    },
    {
      method: "GET",
      plane: "api",
      pattern: /^\/v1\/worlds\/([^/]+)\/usage$/,
      handle: (request, match) =>
        owned(request.token, match[1])
          ? { status: 200, json: { entries: [] } }
          : { status: 404, json: { error: "not found" } },
    },
    {
      method: "GET",
      plane: "api",
      pattern: /^\/v1\/worlds\/([^/]+)\/(limits|billing)$/,
      handle: (request, match) =>
        owned(request.token, match[1])
          ? {
              status: 200,
              json:
                match[2] === "limits"
                  ? { limits: { worlds: 100 } }
                  : { billing: { plan: "mock" } },
            }
          : { status: 404, json: { error: "not found" } },
    },
  ];
}

export function embeddingCredentialRoutes(state) {
  const guard = (token) => {
    const caller = token ? resolveCaller(state, token) : { kind: "anonymous" };
    return caller.kind === "platform" || caller.kind === "admin";
  };
  return [
    {
      method: "PUT",
      plane: "api",
      pattern: /^\/v1\/users\/me\/embedding-providers\/([^/]+)$/,
      handle: ({ token }) => {
        if (!guard(token)) return { status: 401, json: { error: "invalid token" } };
        state.credentialActive = true;
        return { status: 200, json: { status: "active", last4: "1234" } };
      },
    },
    {
      method: "DELETE",
      plane: "api",
      pattern: /^\/v1\/users\/me\/embedding-providers\/([^/]+)$/,
      handle: ({ token }) => {
        if (!guard(token)) return { status: 401, json: { error: "invalid token" } };
        state.credentialActive = false;
        return { status: 204, text: "" };
      },
    },
  ];
}
