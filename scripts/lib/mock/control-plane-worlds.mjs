// Control-plane world-by-id routes for the script mock server (wazoo-api#149):
// read, update, delete, undelete, and world-token mint/revoke. Ownership is
// enforced the way the real service is, so cross-user denials 404 for real.
import { ownedWorld } from "./access.mjs";
import { worldTokenFor } from "./state.mjs";

export function worldByIdRoutes(state) {
  const shape = (world) => ({
    id: world.id,
    displayName: world.displayName,
    state: world.state,
  });
  return [
    {
      method: "GET",
      plane: "api",
      pattern: /^\/v1\/worlds\/([^/]+)$/,
      handle: (request, match) => {
        const found = ownedWorld(state, request.token, match[1]);
        if (!found) return { status: 404, json: { error: "not found" } };
        return { status: 200, json: { world: shape(found.world) } };
      },
    },
    {
      method: "PATCH",
      plane: "api",
      pattern: /^\/v1\/worlds\/([^/]+)$/,
      handle: (request, match) => {
        const found = ownedWorld(state, request.token, match[1]);
        if (!found) return { status: 404, json: { error: "not found" } };
        if (request.body?.world?.displayName !== undefined)
          found.world.displayName = request.body.world.displayName;
        return { status: 200, json: { world: shape(found.world) } };
      },
    },
    {
      method: "DELETE",
      plane: "api",
      pattern: /^\/v1\/worlds\/([^/]+)$/,
      handle: (request, match) => {
        const found = ownedWorld(state, request.token, match[1]);
        if (!found) return { status: 404, json: { error: "not found" } };
        // The real DELETE is a soft delete: the row stays until it can be
        // undeleted, which private-beta-health exercises.
        found.world.state = "DELETED";
        return { status: 200, json: { world: { id: match[1], state: "DELETED" } } };
      },
    },
    {
      method: "POST",
      plane: "api",
      pattern: /^\/v1\/worlds\/([^/]+)\/undelete$/,
      handle: (request, match) => {
        const found = ownedWorld(state, request.token, match[1]);
        if (!found) return { status: 404, json: { error: "not found" } };
        found.world.state = "ACTIVE";
        return { status: 200, json: { world: shape(found.world) } };
      },
    },
    {
      method: "POST",
      plane: "api",
      pattern: /^\/v1\/worlds\/([^/]+)\/auth\/tokens$/,
      handle: (request, match) => {
        const found = ownedWorld(state, request.token, match[1]);
        if (!found) return { status: 404, json: { error: "not found" } };
        const token = worldTokenFor(state);
        const uid = `wt-${state.nextSeq("tokens")}`;
        found.world.tokens.set(uid, { token, name: request.body?.name ?? "" });
        return { status: 201, json: { token: { token, uid, name: request.body?.name ?? "" } } };
      },
    },
    {
      method: "DELETE",
      plane: "api",
      pattern: /^\/v1\/worlds\/([^/]+)\/auth\/tokens\/([^/]+)$/,
      handle: (request, match) => {
        const found = ownedWorld(state, request.token, match[1]);
        if (!found || !found.world.tokens.has(match[2]))
          return { status: 404, json: { error: "not found" } };
        found.world.tokens.delete(match[2]);
        return { status: 204, text: "" };
      },
    },
  ];
}
