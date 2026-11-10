import { describe, expect, it } from "vitest";
import {
  api,
  requestFromCall,
  state,
  useWorldsHarness,
  ADMIN_TOKEN,
} from "./helpers/worlds-harness";
import {
  runListWorlds,
  runSearchWorlds,
  runSparqlQuery,
  type McpDeps,
} from "../src/routes/mcp";
import type { Bindings } from "../src/env";

describe("MCP world scoping (wazoo-api#159)", () => {
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
        body: JSON.stringify({ world: { displayName: "MCP Owned World" } }),
      },
      h.env,
    );
    expect(created.status).toBe(201);
    const worldId = state.lastCreatedWorldId;
    const row = (await h.env.DB.prepare(
      "SELECT user_uid FROM worlds WHERE world_id = ?",
    )
      .bind(worldId)
      .first<{ user_uid: string }>()) as { user_uid: string };
    return { worldId, userUid: row.user_uid };
  }

  const depsFor = (env: Bindings, userUid: string): McpDeps => ({
    env,
    userUid,
    waitUntil: () => {},
  });

  it("rejects requests without a platform token", async () => {
    const res = await api("/mcp", { method: "POST" }, h.env);
    expect(res.status).toBe(401);
  });

  it("rejects admin tokens, which carry no user identity", async () => {
    const res = await api(
      "/mcp",
      {
        method: "POST",
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      },
      h.env,
    );
    expect(res.status).toBe(403);
  });

  it("refuses a world the caller does not own before touching worlds-api", async () => {
    const { userUid } = await setup();
    const calls: string[] = [];
    h.worldsApiMock.mockImplementation((input, init) => {
      calls.push(new URL(requestFromCall(input, init).url).pathname);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await expect(
      runSearchWorlds(depsFor(h.env, userUid), {
        worldId: "w_someoneelsesworld",
        query: "test",
      }),
    ).rejects.toThrow("World not found");
    expect(calls).toEqual([]);
  });

  it("searches an owned world with a namespace-bound credential", async () => {
    const { worldId, userUid } = await setup();
    const dataPlane: { path: string; auth: string }[] = [];
    const mints: { namespace: string; worldId: string }[] = [];
    const revocations: string[] = [];
    h.worldsApiMock.mockImplementation(async (input, init) => {
      const req = requestFromCall(input, init);
      const url = new URL(req.url);
      if (url.pathname === "/api-keys" && req.method === "POST") {
        const body = JSON.parse(await req.text()) as {
          namespace: string;
          worldId: string;
        };
        mints.push(body);
        return new Response(
          JSON.stringify({ uid: "key-mcp-1", token: "wzw_scoped-key" }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }
      if (url.pathname.startsWith("/api-keys/") && req.method === "DELETE") {
        revocations.push(url.pathname.split("/").pop() ?? "");
        return new Response(null, { status: 204 });
      }
      if (url.pathname === `/worlds/${worldId}/search`) {
        dataPlane.push({
          path: url.pathname,
          auth: req.headers.get("authorization") ?? "",
        });
        return new Response(JSON.stringify({ hits: [] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ error: { code: "UNEXPECTED", message: url } }),
        { status: 500 },
      );
    });
    const result = (await runSearchWorlds(depsFor(h.env, userUid), {
      worldId,
      query: "hello",
    })) as { hits: unknown[] };
    expect(result.hits).toEqual([]);
    expect(mints).toEqual([{ namespace: userUid, worldId, name: "mcp" }]);
    expect(dataPlane).toEqual([
      { path: `/worlds/${worldId}/search`, auth: "Bearer wzw_scoped-key" },
    ]);
    expect(revocations).toEqual(["key-mcp-1"]);
  });

  it("runs SPARQL against an owned world only, with a scoped credential", async () => {
    const { worldId, userUid } = await setup();
    const seen: { path: string; auth: string }[] = [];
    h.worldsApiMock.mockImplementation((input, init) => {
      const req = requestFromCall(input, init);
      const url = new URL(req.url);
      if (url.pathname === "/api-keys" && req.method === "POST") {
        return new Response(
          JSON.stringify({ uid: "key-mcp-2", token: "wzw_scoped-key" }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }
      if (url.pathname === `/worlds/${worldId}/sparql`) {
        seen.push({
          path: url.pathname,
          auth: req.headers.get("authorization") ?? "",
        });
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ error: { code: "UNEXPECTED", message: url } }),
        { status: 500 },
      );
    });
    const result = (await runSparqlQuery(depsFor(h.env, userUid), {
      worldId,
      query: "SELECT * WHERE { ?s ?p ?o }",
    })) as { results: unknown[] };
    expect(result.results).toEqual([]);
    expect(seen).toEqual([
      { path: `/worlds/${worldId}/sparql`, auth: "Bearer wzw_scoped-key" },
    ]);
    await expect(
      runSparqlQuery(depsFor(h.env, userUid), {
        worldId: "w_notyours",
        query: "SELECT * WHERE { ?s ?p ?o }",
      }),
    ).rejects.toThrow("World not found");
    expect(seen).toHaveLength(1);
  });

  it("lists worlds from the control plane, never the data plane", async () => {
    const { userUid } = await setup();
    h.worldsApiMock.mockImplementation(() => {
      throw new Error("data plane must not be contacted by list");
    });
    const result = (await runListWorlds(depsFor(h.env, userUid))) as {
      worlds: { id: string }[];
    };
    expect(result.worlds.map((w) => w.id)).toContain(state.lastCreatedWorldId);
  });
});
