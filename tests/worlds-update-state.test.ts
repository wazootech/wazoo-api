import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  api,
  requestFromCall,
  state,
  useWorldsHarness,
} from "./helpers/worlds-harness";
import type { TestD1 } from "./helpers/d1-test-adapter";

/**
 * Awaited lifecycle writes for PATCH /v1/worlds/{worldId} state (wazoo-api#22):
 * pausing is a time-limited, awaited worlds-api write; resuming is awaited;
 * the local row only moves after worlds-api confirms, so a worlds-api failure
 * is a 502 and never a one-sided success.
 */

function worldsApiLifecycleMock(
  defaults: (input: RequestInfo | URL, init?: RequestInit) => Response,
) {
  return (input: RequestInfo | URL, init?: RequestInit): Response => {
    const req = requestFromCall(input, init);
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname.endsWith("/pause")) {
      return new Response(
        JSON.stringify({
          id: state.lastCreatedWorldId,
          displayName: "My World",
          state: "paused",
          storage: "d1",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (req.method === "POST" && url.pathname.endsWith("/resume")) {
      return new Response(
        JSON.stringify({
          id: state.lastCreatedWorldId,
          displayName: "My World",
          state: "active",
          storage: "d1",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return defaults(input, init);
  };
}

function localWorldState(env: TestD1): string | null {
  const client = new DatabaseSync(env.path);
  const rs = client
    .prepare("SELECT state FROM worlds WHERE world_id = ?")
    .all(state.lastCreatedWorldId) as { state: string }[];
  client.close();
  return rs[0]?.state ?? null;
}

async function createWorld(h: ReturnType<typeof useWorldsHarness>) {
  const res = await api(
    "/v1/worlds",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${h.sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "My World" }),
    },
    h.env,
  );
  expect(res.status).toBe(201);
  return state.lastCreatedWorldId;
}

describe("PATCH state is an awaited worlds-api write (wazoo-api#22)", () => {
  const h = useWorldsHarness();

  it("rejects a pause without a time limit", async () => {
    await createWorld(h);
    const res = await api(
      `/v1/worlds/${state.lastCreatedWorldId}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${h.sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          updateMask: "state",
          world: { state: "SUSPENDED" },
        }),
      },
      h.env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_ARGUMENT");
  });

  it("pauses with a mandatory duration and records it locally only after worlds-api confirms", async () => {
    h.worldsApiMock.mockImplementation(
      worldsApiLifecycleMock((input, init) => {
        // Fall through to the shared create/undelete handling.
        const req = requestFromCall(input, init);
        const url = new URL(req.url);
        if (url.pathname === "/api-keys" && req.method === "POST") {
          return new Response(
            JSON.stringify({ uid: "key-1", token: "wzw_test-key" }),
            { status: 201, headers: { "content-type": "application/json" } },
          );
        }
        if (url.pathname === "/worlds" && req.method === "POST") {
          state.lastCreatedWorldId = `w_00000000000000${String(++state.createdCounter).padStart(12, "0")}`;
          return new Response(
            JSON.stringify({
              id: state.lastCreatedWorldId,
              displayName: "My World",
              state: "active",
              storage: "d1",
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            error: { code: "UNEXPECTED", message: url.pathname },
          }),
          { status: 500 },
        );
      }),
    );
    await createWorld(h);
    const res = await api(
      `/v1/worlds/${state.lastCreatedWorldId}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${h.sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          updateMask: "state",
          world: { state: "SUSPENDED", pauseDurationSeconds: 3600 },
        }),
      },
      h.env,
    );
    expect(res.status).toBe(200);
    const pauseCall = h.worldsApiMock.mock.calls.find((call) => {
      const req = requestFromCall(call[0], call[1]);
      return req.url.endsWith("/pause") && req.method === "POST";
    });
    expect(pauseCall).toBeTruthy();
    const pauseReq = requestFromCall(pauseCall![0], pauseCall![1]);
    expect(await pauseReq.json()).toEqual({ durationSeconds: 3600 });
    expect(localWorldState(h.env.DB as TestD1)).toBe("suspended");
  });

  it("returns 502 and leaves the local state untouched when worlds-api fails the pause", async () => {
    // The default harness handler answers 500 UNEXPECTED for /pause.
    await createWorld(h);
    const res = await api(
      `/v1/worlds/${state.lastCreatedWorldId}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${h.sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          updateMask: "state",
          world: { state: "SUSPENDED", pauseDurationSeconds: 3600 },
        }),
      },
      h.env,
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("WORLD_UPDATE_FAILED");
    expect(localWorldState(h.env.DB as TestD1)).toBe("active");
  });

  it("resumes through an awaited worlds-api call", async () => {
    h.worldsApiMock.mockImplementation(
      worldsApiLifecycleMock((input, init) => {
        const req = requestFromCall(input, init);
        const url = new URL(req.url);
        if (url.pathname === "/api-keys" && req.method === "POST") {
          return new Response(
            JSON.stringify({ uid: "key-1", token: "wzw_test-key" }),
            { status: 201, headers: { "content-type": "application/json" } },
          );
        }
        if (url.pathname === "/worlds" && req.method === "POST") {
          state.lastCreatedWorldId = `w_00000000000000${String(++state.createdCounter).padStart(12, "0")}`;
          return new Response(
            JSON.stringify({
              id: state.lastCreatedWorldId,
              displayName: "My World",
              state: "active",
              storage: "d1",
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            error: { code: "UNEXPECTED", message: url.pathname },
          }),
          { status: 500 },
        );
      }),
    );
    await createWorld(h);
    const res = await api(
      `/v1/worlds/${state.lastCreatedWorldId}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${h.sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          updateMask: "state",
          world: { state: "ACTIVE" },
        }),
      },
      h.env,
    );
    expect(res.status).toBe(200);
    const resumeCall = h.worldsApiMock.mock.calls.find((call) => {
      const req = requestFromCall(call[0], call[1]);
      return req.url.endsWith("/resume") && req.method === "POST";
    });
    expect(resumeCall).toBeTruthy();
    expect(localWorldState(h.env.DB as TestD1)).toBe("active");
  });

  it("returns 502 and leaves the local state untouched when worlds-api fails the resume", async () => {
    // The default harness handler answers 500 UNEXPECTED for /resume.
    await createWorld(h);
    const res = await api(
      `/v1/worlds/${state.lastCreatedWorldId}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${h.sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          updateMask: "state",
          world: { state: "ACTIVE" },
        }),
      },
      h.env,
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("WORLD_UPDATE_FAILED");
    expect(localWorldState(h.env.DB as TestD1)).toBe("active");
  });
});
