import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  ADMIN_TOKEN,
  api,
  budgetAppliedResponse,
  requestFromCall,
  state,
  useWorldsHarness,
} from "./helpers/worlds-harness";
import type { TestD1 } from "./helpers/d1-test-adapter";

describe("world ownership collapse (wazoo-api#20)", () => {
  const h = useWorldsHarness();

  it("creates a world by minting a scoped key and calling worlds-api", async () => {
    const res = await api(
      "/v1/worlds",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${h.sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          world: { displayName: "My World" },
        }),
      },
      h.env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      world: { id: string; displayName: string };
    };
    expect(body.world.id).toBe(state.lastCreatedWorldId);
    expect(body.world.displayName).toBe("My World");
    expect(body.world).not.toHaveProperty("uid");
    expect(body.world).not.toHaveProperty("worldId");
    expect(body.world).not.toHaveProperty("slug");

    const keyCall = h.worldsApiMock.mock.calls.find((call) => {
      const req = requestFromCall(call[0], call[1]);
      return req.url.endsWith("/api-keys") && req.method === "POST";
    });
    expect(keyCall).toBeTruthy();
    const keyReq = requestFromCall(keyCall![0], keyCall![1]);
    const keyBody = (await keyReq.json()) as { namespace: string };
    expect(keyBody.namespace).toBeTruthy();

    const worldCall = h.worldsApiMock.mock.calls.find((call) => {
      const req = requestFromCall(call[0], call[1]);
      return req.url.endsWith("/worlds") && req.method === "POST";
    });
    expect(worldCall).toBeTruthy();
    const worldReq = requestFromCall(worldCall![0], worldCall![1]);
    expect(worldReq.headers.get("Authorization")).toBe("Bearer wzw_test-key");
    expect(await worldReq.json()).toEqual({ displayName: "My World" });

    const client = new DatabaseSync((h.env.DB as TestD1).path);
    const rs = client
      .prepare("SELECT world_id FROM worlds WHERE world_id = ?")
      .all(state.lastCreatedWorldId);
    client.close();
    expect(rs.length).toBe(1);
    expect(rs[0].world_id).toBe(state.lastCreatedWorldId);
  });

  it("fails closed when worlds-api returns the legacy uid field", async () => {
    h.worldsApiMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ uid: "key-1", token: "wzw_test-key" }), {
          status: 201,
        }),
      )
      .mockResolvedValueOnce(budgetAppliedResponse())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            uid: "w_00000000000000000000000002",
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      );

    const res = await api(
      "/v1/worlds",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${h.sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ world: { displayName: "Legacy Response" } }),
      },
      h.env,
    );

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("WORLD_PROVISIONING_FAILED");
  });

  it("returns 409 when worlds-api returns an ID already used by another owner", async () => {
    const first = await api(
      "/v1/worlds",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${h.sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ world: { displayName: "First World" } }),
      },
      h.env,
    );
    expect(first.status).toBe(201);
    const duplicateWorldId = state.lastCreatedWorldId;

    const otherSession = await api(
      "/v1/auth/workos-session",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${ADMIN_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "other-worlds-user@example.com",
          displayName: "Other Worlds User",
          ageConfirmed: true,
        }),
      },
      h.env,
    );
    expect(otherSession.status).toBe(201);
    const otherToken = ((await otherSession.json()) as { token: string }).token;

    h.worldsApiMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ uid: "key-2", token: "wzw_test-key-2" }),
          {
            status: 201,
          },
        ),
      )
      .mockResolvedValueOnce(budgetAppliedResponse())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: duplicateWorldId }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );

    const duplicate = await api(
      "/v1/worlds",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${otherToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ world: { displayName: "Duplicate World" } }),
      },
      h.env,
    );

    expect(duplicate.status).toBe(409);
    const body = (await duplicate.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ALREADY_EXISTS");
  });
});
