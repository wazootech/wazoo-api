// In-memory state for the mock control/data plane (wazoo-api#149). Fresh per
// process; ids come from a counter, never the clock, so responses are
// deterministic. Fixture token values are placeholders, never real secrets.
import { sequencedWorldId } from "../world-id.mjs";

export const MOCK_ADMIN_TOKEN = "mock-admin-token";
export const MOCK_DATA_ADMIN_TOKEN = "mock-data-admin-token";
export const PLATFORM_TOKEN_PREFIX = "wzp_";
export const WORLD_TOKEN_PREFIX = "wzw_";

export function createMockState() {
  const seq = { users: 0, worlds: 0, tokens: 0 };
  return {
    users: new Map(), // email -> { uid, email }
    platformTokens: new Map(), // token -> { uid, name, scope, expiresAt, email }
    worlds: new Map(), // id -> world record
    adminToken: MOCK_ADMIN_TOKEN,
    dataAdminToken: MOCK_DATA_ADMIN_TOKEN,
    credentialActive: false,
    nextSeq: (kind) => ++seq[kind],
    worldId: () => sequencedWorldId(seq.worlds + 1),
  };
}

export function isAdmin(state, token) {
  return token === state.adminToken;
}

export function isDataAdmin(state, token) {
  return token === state.dataAdminToken;
}

// Resolves a caller: admin, a minted platform token, or a world-bound token.
export function resolveCaller(state, token) {
  if (token === null) return { kind: "anonymous" };
  if (isAdmin(state, token)) return { kind: "admin" };
  if (isDataAdmin(state, token)) return { kind: "dataAdmin" };
  const platform = state.platformTokens.get(token);
  if (platform) return { kind: "platform", record: platform };
  for (const world of state.worlds.values()) {
    for (const record of world.tokens.values())
      if (record.token === token)
        return { kind: "world", record, worldId: world.id };
  }
  return { kind: "unknown" };
}

export function userFor(state, email) {
  let user = state.users.get(email);
  if (!user) {
    user = { uid: `uid-${state.nextSeq("users")}`, email };
    state.users.set(email, user);
  }
  return user;
}

export function createWorld(state, { ownerUid, ownerEmail, displayName }) {
  const id = state.worldId();
  state.nextSeq("worlds");
  const world = {
    id,
    ownerUid,
    ownerEmail,
    displayName,
    state: "ACTIVE",
    tokens: new Map(),
    chunks: [],
    quads: [],
    triples: [],
    embeddingModel: null,
    embeddingStatus: null,
  };
  state.worlds.set(id, world);
  return world;
}

export function platformTokenFor(state) {
  return `wzp_mock${state.nextSeq("tokens")}`;
}

export function worldTokenFor(state) {
  return `wzw_mock${state.nextSeq("tokens")}`;
}
