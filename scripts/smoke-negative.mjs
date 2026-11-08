/**
 * Negative regression assertions for the platform smoke gate: each proves a
 * shipped security fix still refuses. Throwaway worlds and tokens only, all
 * removed by cleanup(). The caller owns target validation (assertSmokeTarget).
 */
import { createContext } from "./smoke-negative-core.mjs";
import { dataPlaneChecks, LOAD_TARGET } from "./smoke-negative-data.mjs";

export { LOAD_TARGET };

export function createNegativeChecks(options) {
  const ctx = createContext(options);
  const { apiUrl, adminToken, ownerEmail, runId } = ctx;
  const { json, send, run, first, expectStatus } = ctx;

  const mint = (token, tokenName, extra) => {
    ctx.tokenNames.push(tokenName);
    return send(`${apiUrl}/v1/auth/api-tokens`, "POST", token, {
      email: ownerEmail,
      tokenName,
      ...extra,
    });
  };

  // wazoo-api#154: a limited token may not mint broader or longer-lived tokens.
  const testTokenMintClamp = () =>
    run("testTokenMintClamp", async () => {
      const soon = new Date(Date.now() + 3_600_000).toISOString();
      const later = new Date(Date.now() + 86_400_000).toISOString();
      const parent = await mint(adminToken, `smoke-lim-${runId}`, {
        scope: "users.write worlds.read",
        expiresAt: soon,
      });
      if (parent.status !== 201)
        return `mint limited token: expected 201, got ${parent.status}`;
      const limited = (await json(parent))?.token;
      if (!limited) return "mint limited token: no token in response";
      const wider = await mint(limited, `smoke-wide-${runId}`, {
        scope: "users.write worlds.read worlds.write",
        expiresAt: soon,
      });
      const longer = await mint(limited, `smoke-long-${runId}`, {
        scope: "worlds.read",
        expiresAt: later,
      });
      return first(
        expectStatus("broader scope", wider, 403),
        expectStatus("longer expiry", longer, 403),
      );
    });

  // wazoo-api#156: revoke through another world path must 404.
  const testCrossWorldRevoke = (worldId, worldTokenUid) =>
    run("testCrossWorldRevoke", async () => {
      if (!worldId || !worldTokenUid) return "no world/token uid on context";
      const created = await send(`${apiUrl}/v1/worlds`, "POST", adminToken, {
        ownerEmail,
        world: { displayName: `E2E Other ${runId}`, region: "auto" },
      });
      if (created.status !== 201)
        return `create other world: expected 201, got ${created.status}`;
      const otherId = (await json(created))?.world?.id;
      if (!otherId) return "create other world: no id";
      ctx.worldIds.push(otherId);
      const email = encodeURIComponent(ownerEmail);
      const url = `${apiUrl}/v1/worlds/${otherId}/auth/tokens/${worldTokenUid}?email=${email}`;
      return expectStatus(
        "cross-world revoke",
        await send(url, "DELETE", adminToken),
        404,
      );
    });

  return {
    testTokenMintClamp,
    testCrossWorldRevoke,
    ...dataPlaneChecks(ctx),
    cleanup: ctx.cleanup,
  };
}
