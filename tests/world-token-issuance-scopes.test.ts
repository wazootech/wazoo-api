import { describe, expect, it } from "vitest";
import {
  api,
  requestFromCall,
  state,
  useWorldsHarness,
} from "./helpers/worlds-harness";
import { WORLD_TOKEN_DEFAULT_SCOPES } from "../src/lib/scopes";

// Fake fixture values only (memory#67). The scopes below are worlds-api
// data-plane scope names, not secrets.
const READ_WRITE = ["data:read", "data:write"];

describe("world-token issuance decides scopes (wazoo-api#21)", () => {
  const h = useWorldsHarness();

  async function createWorld() {
    const res = await api(
      "/v1/worlds",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${h.sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ displayName: "Scoped World" }),
      },
      h.env,
    );
    expect(res.status).toBe(201);
    return state.lastCreatedWorldId;
  }

  async function createToken(worldId: string, body: Record<string, unknown>) {
    return api(
      `/v1/worlds/${worldId}/auth/tokens`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${h.sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
      h.env,
    );
  }

  /** Captures the JSON body the route sent to worlds-api POST /api-keys. */
  function captureCreateBody(): () => Promise<
    Record<string, unknown> | undefined
  > {
    let sent: Request | undefined;
    h.worldsApiMock.mockImplementation(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const req = requestFromCall(input, init);
        const url = new URL(req.url);
        if (url.pathname === "/api-keys" && req.method === "POST") {
          sent = req.clone();
          return new Response(
            JSON.stringify({ uid: "key-1", token: "wzw_test-key" }),
            { status: 201, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({ error: { code: "UNEXPECTED", message: url } }),
          { status: 500, headers: { "content-type": "application/json" } },
        );
      },
    );
    return async () =>
      sent ? ((await sent.json()) as Record<string, unknown>) : undefined;
  }

  it("defaults an omitted scope grant to the least-privilege set", async () => {
    const worldId = await createWorld();
    const getSent = captureCreateBody();
    const res = await createToken(worldId, { name: "default" });
    expect(res.status).toBe(201);
    const sent = await getSent();
    expect(sent?.scopes).toEqual(WORLD_TOKEN_DEFAULT_SCOPES);
  });

  it("forwards an explicit scope grant verbatim", async () => {
    const worldId = await createWorld();
    const getSent = captureCreateBody();
    const res = await createToken(worldId, { name: "rw", scopes: READ_WRITE });
    expect(res.status).toBe(201);
    const sent = await getSent();
    expect(sent?.scopes).toEqual(READ_WRITE);
  });

  it("rejects scopes outside the issuable set", async () => {
    const worldId = await createWorld();
    const getSent = captureCreateBody();
    const res = await createToken(worldId, {
      name: "admin-ish",
      scopes: ["embeddings:admin"],
    });
    expect(res.status).toBe(400);
    expect(await getSent()).toBeUndefined();
  });

  it("rejects an empty scope grant", async () => {
    const worldId = await createWorld();
    const getSent = captureCreateBody();
    const res = await createToken(worldId, { name: "none", scopes: [] });
    expect(res.status).toBe(400);
    expect(await getSent()).toBeUndefined();
  });
});
