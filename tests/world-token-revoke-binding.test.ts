import { describe, expect, it } from "vitest";
import {
  api,
  requestFromCall,
  state,
  useWorldsHarness,
} from "./helpers/worlds-harness";

// Fake fixture values only (memory#69).
const OWN_KEY = "key-own-world";
const OTHER_WORLD_KEY = "key-other-world";
const FOREIGN_KEY = "key-foreign-namespace";

describe("world-token revoke is bound to the caller's world (memory#69)", () => {
  const h = useWorldsHarness();

  async function setup() {
    const created = await api(
      "/v1/worlds",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${h.sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ world: { displayName: "Bound World" } }),
      },
      h.env,
    );
    expect(created.status).toBe(201);
    const worldId = state.lastCreatedWorldId;
    const fallback = h.worldsApiMock.getMockImplementation() as (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => Response;
    const revoked: string[] = [];
    h.worldsApiMock.mockImplementation(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const req = requestFromCall(input, init);
        const url = new URL(req.url);
        if (url.pathname === "/api-keys" && req.method === "GET") {
          const ns = url.searchParams.get("namespace") ?? "";
          const key = (uid: string, worldId: string, namespace = ns) => ({
            uid,
            name: uid,
            namespace,
            worldId,
            scopes: [],
          });
          return new Response(
            JSON.stringify({
              keys: [key(OWN_KEY, worldId), key(OTHER_WORLD_KEY, "w_other")],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.pathname.startsWith("/api-keys/") && req.method === "DELETE") {
          revoked.push(url.pathname.split("/").pop() ?? "");
          return new Response(null, { status: 204 });
        }
        return fallback(input, init);
      },
    );
    return { worldId, revoked };
  }

  const del = (worldId: string, uid: string) =>
    api(
      `/v1/worlds/${worldId}/auth/tokens/${uid}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${h.sessionToken}` },
      },
      h.env,
    );

  it("revokes a key that belongs to the path world", async () => {
    const { worldId, revoked } = await setup();
    expect((await del(worldId, OWN_KEY)).status).toBe(204);
    expect(revoked).toEqual([OWN_KEY]);
  });

  it("does not revoke a key from another world of the caller", async () => {
    const { worldId, revoked } = await setup();
    expect((await del(worldId, OTHER_WORLD_KEY)).status).toBe(404);
    expect(revoked).toEqual([]);
  });

  it("does not revoke a key outside the caller's namespace", async () => {
    const { worldId, revoked } = await setup();
    expect((await del(worldId, FOREIGN_KEY)).status).toBe(404);
    expect(revoked).toEqual([]);
  });
});
