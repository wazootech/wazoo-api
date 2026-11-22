// Shared lookups for the mock control/data plane (wazoo-api#149).
import { resolveCaller } from "./state.mjs";

// A world record visible to this caller: admin sees any; a platform token sees
// its own; a world token never grants namespace-level access.
export function ownedWorld(state, token, id) {
  const world = state.worlds.get(id);
  if (!world) return null;
  const caller = resolveCaller(state, token);
  if (caller.kind === "admin") return { world, caller };
  if (caller.kind === "platform" && world.ownerUid === caller.record.userUid)
    return { world, caller };
  return null;
}

// Data-plane view: the world token must be bound to exactly this world.
export function worldForToken(state, token, id) {
  const world = state.worlds.get(id);
  if (!world) return null;
  const caller = token ? resolveCaller(state, token) : { kind: "anonymous" };
  if (caller.kind === "world" && caller.worldId === id) return world;
  return null;
}
