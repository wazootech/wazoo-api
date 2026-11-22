// Private beta health: world and token step functions (wazoo-api#149).
// Behavior identical to the pre-split inline code; each receives the driver's
// context (http clients, run info, shared state).
import { apiRequest, assert } from "./client.mjs";

export async function ensureUser(context) {
  const response = await apiRequest(context)(
    `/v1/users/me?email=${encodeURIComponent(context.email)}`,
    { allowStatus: [200, 201] },
  );
  context.state.userUid = response.body.user.uid;
  assert(response.body.user.email === context.email, "Test user email mismatch");
  return response;
}

export async function createWorld(context, worldName) {
  const response = await apiRequest(context)("/v1/worlds", {
    method: "POST",
    body: {
      ownerEmail: context.email,
      displayName: `Health World ${worldName}`,
    },
  });
  const id = response.body.world?.id;
  assert(
    typeof id === "string" && /^w_[0-7][0-9a-hjkmnp-tv-z]{25}$/.test(id),
    `World ${worldName} did not return a canonical ID`,
  );
  context.state.worldByName[worldName] = id;
  if (worldName === context.worldNames[0]) context.state.worldId = id;
  return response;
}

export async function createWorldToken(context) {
  const response = await apiRequest(context)(
    `/v1/worlds/${context.state.worldId}/auth/tokens?email=${encodeURIComponent(context.email)}`,
    {
      method: "POST",
      body: { name: `health-${context.runId}` },
    },
  );
  context.state.worldTokenUid = response.body.token.uid;
  context.state.worldToken = response.body.token.token;
  assert(context.state.worldToken?.startsWith("wzw_"), "World token was not returned");
  return response;
}

export async function revokeWorldToken(context) {
  const { state, email } = context;
  if (!state.worldTokenUid) throw new Error("Missing world token uid");
  return apiRequest(context)(
    `/v1/worlds/${state.worldId}/auth/tokens/${state.worldTokenUid}?email=${encodeURIComponent(email)}`,
    { method: "DELETE" },
  );
}

export async function deleteWorld(context, worldId) {
  return apiRequest(context)(`/v1/worlds/${worldId}?email=${encodeURIComponent(context.email)}`, {
    method: "DELETE",
  });
}

export async function undeleteWorld(context, worldId) {
  return apiRequest(context)(
    `/v1/worlds/${worldId}/undelete?email=${encodeURIComponent(context.email)}`,
    { method: "POST" },
  );
}
