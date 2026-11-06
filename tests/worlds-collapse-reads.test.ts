import { describe, expect, it } from "vitest";
import {
  ADMIN_TOKEN,
  api,
  budgetAppliedResponse,
  requestFromCall,
  state,
  useWorldsHarness,
} from "./helpers/worlds-harness";

describe("world ownership collapse (wazoo-api#20)", () => {
  const h = useWorldsHarness();

  it("keeps world reads scoped to the authenticated owner", async () => {
    const created = await api(
      "/v1/worlds",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${h.sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ world: { displayName: "Owned World" } }),
      },
      h.env,
    );
    expect(created.status).toBe(201);

    const otherSession = await api(
      "/v1/auth/workos-session",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${ADMIN_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "non-owner@example.com",
          displayName: "Non-owner",
          ageConfirmed: true,
        }),
      },
      h.env,
    );
    expect(otherSession.status).toBe(201);
    const otherToken = ((await otherSession.json()) as { token: string }).token;

    const get = await api(
      `/v1/worlds/${state.lastCreatedWorldId}`,
      { headers: { authorization: `Bearer ${otherToken}` } },
      h.env,
    );
    expect(get.status).toBe(404);

    const upstreamCallsBeforeMutation = h.worldsApiMock.mock.calls.length;
    const update = await api(
      `/v1/worlds/${state.lastCreatedWorldId}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${otherToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          updateMask: "displayName",
          world: { displayName: "Unauthorized update" },
        }),
      },
      h.env,
    );
    expect(update.status).toBe(404);

    const remove = await api(
      `/v1/worlds/${state.lastCreatedWorldId}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${otherToken}` },
      },
      h.env,
    );
    expect(remove.status).toBe(404);
    expect(h.worldsApiMock.mock.calls).toHaveLength(
      upstreamCallsBeforeMutation,
    );
  });

  it("deletes via worlds-api by canonical world_id and mirrors state locally", async () => {
    const create = await api(
      "/v1/worlds",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${h.sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          world: { displayName: "Del World" },
        }),
      },
      h.env,
    );
    expect(create.status).toBe(201);

    const res = await api(
      `/v1/worlds/${state.lastCreatedWorldId}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${h.sessionToken}` },
      },
      h.env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { world: { state: string } };
    expect(body.world.state).toBe("DELETED");

    const deleteCall = h.worldsApiMock.mock.calls.find((call) => {
      const req = requestFromCall(call[0], call[1]);
      return (
        req.url.includes(`/worlds/${state.lastCreatedWorldId}`) &&
        req.method === "DELETE"
      );
    });
    expect(deleteCall).toBeTruthy();
  });

  it("returns 502 when worlds-api create fails", async () => {
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
            error: {
              code: "PROVISIONING_FAILED",
              message: "data plane unavailable",
            },
          }),
          { status: 502 },
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
        body: JSON.stringify({
          world: { displayName: "Fail World" },
        }),
      },
      h.env,
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("WORLD_PROVISIONING_FAILED");
    expect(body.error.message).toContain("data plane unavailable");
  });
});
