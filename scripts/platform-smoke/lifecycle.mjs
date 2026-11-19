// Platform smoke gate: world lifecycle and token management tests
// (wazoo-api#149). Behavior identical to the pre-split inline code.
import { check, jsonOrNull } from "./helpers.mjs";

export async function testWorldLifecycle(context) {
  const { API_BASE_URL, ADMIN, ownerEmail, runId, http } = context;
  return check("testWorldLifecycle", async () => {
    const userResponse = await http(
      `${API_BASE_URL}/v1/users/me?email=${encodeURIComponent(ownerEmail)}`,
      { headers: { Authorization: `Bearer ${ADMIN}` } },
    );
    if (userResponse.status < 200 || userResponse.status >= 300) {
      return {
        name: "testWorldLifecycle",
        passed: false,
        detail: `ensure user: expected 2xx, got ${userResponse.status}`,
      };
    }

    const createResponse = await http(`${API_BASE_URL}/v1/worlds`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ADMIN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ownerEmail,
        displayName: `E2E Test ${runId}`,
        region: "auto",
      }),
    });
    if (createResponse.status !== 201) {
      return {
        name: "testWorldLifecycle",
        passed: false,
        detail: `create world: expected 201, got ${createResponse.status}`,
      };
    }
    const created = await jsonOrNull(createResponse);
    if (created?.world?.state !== "ACTIVE") {
      return {
        name: "testWorldLifecycle",
        passed: false,
        detail: `create world: expected state ACTIVE, got ${created?.world?.state}`,
      };
    }
    const worldId = created.world?.id;
    if (
      typeof worldId !== "string" ||
      !/^w_[0-7][0-9a-hjkmnp-tv-z]{25}$/.test(worldId)
    ) {
      return {
        name: "testWorldLifecycle",
        passed: false,
        detail: "create world: response did not include a canonical world.id",
      };
    }
    const detail = `world created, ACTIVE, id ${worldId}`;
    return { name: "testWorldLifecycle", passed: true, detail, worldId };
  });
}

export async function testTokenManagement(context, worldId) {
  const { API_BASE_URL, ADMIN, ownerEmail, http } = context;
  return check("testTokenManagement", async () => {
    const tokenResponse = await http(
      `${API_BASE_URL}/v1/worlds/${worldId}/auth/tokens?email=${encodeURIComponent(ownerEmail)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ADMIN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "e2e-test-token" }),
      },
    );
    if (tokenResponse.status !== 201) {
      return {
        name: "testTokenManagement",
        passed: false,
        detail: `create token: expected 201, got ${tokenResponse.status}`,
      };
    }
    const body = await jsonOrNull(tokenResponse);
    const worldToken = body?.token?.token;
    if (!worldToken) {
      return {
        name: "testTokenManagement",
        passed: false,
        detail: "create token: response did not include token secret",
      };
    }
    return {
      name: "testTokenManagement",
      passed: true,
      detail: `world auth token minted (${worldToken.slice(0, 12)}...)`,
      worldToken,
      worldTokenUid: body?.token?.uid,
      worldId,
    };
  });
}
