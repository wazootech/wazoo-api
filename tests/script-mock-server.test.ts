import { describe, expect, it, vi } from "vitest";

// The mock server and mock-aware fetch only engage in mock mode; pin it
// before the .mjs modules evaluate their mode constant.
vi.hoisted(() => {
  process.env.WAZOO_SCRIPT_MODE = "mock";
});
// @ts-expect-error plain .mjs ops script without type declarations
import { createPlatformMock } from "../scripts/lib/mock/index.mjs";
// @ts-expect-error plain .mjs ops script without type declarations
import { mockAwareFetch } from "../scripts/lib/http.mjs";

// The mock server is what dry-run mode runs against; these pin the contract
// the operational scripts assert on (statuses, shapes, ownership refusals).

const MOCK = createPlatformMock({
  api: "https://api-qa.wazoo.dev",
  worlds: "https://data-qa.wazoo.dev",
  console: "https://console-qa.wazoo.dev",
});
const http = mockAwareFetch(MOCK);
const ADMIN = "mock-admin-token";
const JSON_HEADERS = {
  Authorization: `Bearer ${ADMIN}`,
  "Content-Type": "application/json",
};

// Loose view of the mock responses; optional so every access stays defined.
type Json = Record<string, unknown> & {
  world?: { id?: string; state?: string; displayName?: string; slug?: string };
  worlds?: { id: string }[];
  token?: { token?: string; uid?: string };
  tokens?: unknown[];
  imported?: { chunks?: number; quads?: number };
  results?: unknown;
  mode?: string;
  quads?: { subject?: string }[];
};

async function json<T extends object = Json>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe("mock server: control plane", () => {
  it("serves readiness, health and an OpenAPI document", async () => {
    expect(
      (await json(await http("https://api-qa.wazoo.dev/ready"))).status,
    ).toBe("ready");
    expect(
      (await json(await http("https://api-qa.wazoo.dev/health"))).status,
    ).toBe("ok");
    const spec = await json(
      await http("https://api-qa.wazoo.dev/openapi.json"),
    );
    expect(spec.openapi).toBeDefined();
    expect(spec.paths).toBeDefined();
  });

  it("401s unauthenticated and unknown-token callers", async () => {
    expect((await http("https://api-qa.wazoo.dev/v1/worlds")).status).toBe(401);
    expect(
      (
        await http("https://api-qa.wazoo.dev/v1/worlds", {
          headers: { Authorization: "Bearer wzp_invalidtoken123" },
        })
      ).status,
    ).toBe(401);
  });

  it("rejects schema-invalid world creates like the API does", async () => {
    expect(
      (
        await http("https://api-qa.wazoo.dev/v1/worlds", {
          method: "POST",
          headers: JSON_HEADERS,
        })
      ).status,
    ).toBe(400);
    const invalid = await http("https://api-qa.wazoo.dev/v1/worlds", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ worldId: "", displayName: "Test" }),
    });
    expect(invalid.status).toBe(400);
  });

  it("400s /v1/users/me without an email", async () => {
    expect(
      (
        await http("https://api-qa.wazoo.dev/v1/users/me", {
          headers: JSON_HEADERS,
        })
      ).status,
    ).toBe(400);
  });

  it("creates a world for an owner and hides it from other users", async () => {
    const user = await json(
      await http(
        "https://api-qa.wazoo.dev/v1/users/me?email=e2e%2Brun%40wazoo.dev",
        { headers: JSON_HEADERS },
      ),
    );
    expect((user.user as { uid?: string } | undefined)?.uid).toBeTruthy();
    const mint = await json(
      await http("https://api-qa.wazoo.dev/v1/auth/api-tokens", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          email: "e2e+run@wazoo.dev",
          tokenName: "run-a",
          scope: "users.read",
        }),
      }),
    );
    expect(mint.token).toMatch(/^wzp_/);
    const create = await json(
      await http("https://api-qa.wazoo.dev/v1/worlds", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${String(mint.token)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ displayName: "Round trip run" }),
      }),
    );
    expect(create.world?.id).toMatch(/^w_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
    expect("slug" in (create.world ?? {})).toBe(false);

    const mintB = await json(
      await http("https://api-qa.wazoo.dev/v1/auth/api-tokens", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          email: "e2e+other@wazoo.dev",
          tokenName: "run-b",
          scope: "users.read",
        }),
      }),
    );
    const denied = await http(
      `https://api-qa.wazoo.dev/v1/worlds/${create.world?.id}`,
      { headers: { Authorization: `Bearer ${String(mintB.token)}` } },
    );
    expect(denied.status).toBe(404);

    const list = await json(
      await http("https://api-qa.wazoo.dev/v1/worlds", {
        headers: { Authorization: `Bearer ${String(mint.token)}` },
      }),
    );
    expect(list.worlds?.some((world) => world.id === create.world?.id)).toBe(
      true,
    );
    const listB = await json(
      await http("https://api-qa.wazoo.dev/v1/worlds", {
        headers: { Authorization: `Bearer ${mintB.token}` },
      }),
    );
    expect(listB.worlds?.some((world) => world.id === create.world?.id)).toBe(
      false,
    );
  });

  it("clamps token minting: broader scope and longer expiry are refused", async () => {
    const mint = await json(
      await http("https://api-qa.wazoo.dev/v1/auth/api-tokens", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          email: "e2e+run@wazoo.dev",
          tokenName: "run-lim",
          scope: "users.write worlds.read",
          expiresAt: "2026-01-01T01:00:00.000Z",
        }),
      }),
    );
    const limited = `Bearer ${String(mint.token)}`;
    const wider = await http("https://api-qa.wazoo.dev/v1/auth/api-tokens", {
      method: "POST",
      headers: { Authorization: limited, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "e2e+run@wazoo.dev",
        tokenName: "run-wide",
        scope: "users.write worlds.read worlds.write",
        expiresAt: "2026-01-01T01:00:00.000Z",
      }),
    });
    expect(wider.status).toBe(403);
    const longer = await http("https://api-qa.wazoo.dev/v1/auth/api-tokens", {
      method: "POST",
      headers: { Authorization: limited, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "e2e+run@wazoo.dev",
        tokenName: "run-long",
        scope: "worlds.read",
        expiresAt: "2026-01-02T01:00:00.000Z",
      }),
    });
    expect(longer.status).toBe(403);
  });
});

describe("mock server: data plane", () => {
  async function worldToken() {
    const create = await json(
      await http("https://api-qa.wazoo.dev/v1/worlds", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          ownerEmail: "e2e+data@wazoo.dev",
          displayName: "Data",
        }),
      }),
    );
    const mint = await json(
      await http(
        `https://api-qa.wazoo.dev/v1/worlds/${create.world?.id}/auth/tokens`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ name: "wt" }),
        },
      ),
    );
    return {
      worldId: String(create.world?.id),
      token: String((mint.token as { token?: string } | undefined)?.token),
      uid: String((mint.token as { uid?: string } | undefined)?.uid),
    };
  }

  it("imports turtle (4 statements), answers COUNT, export and search", async () => {
    const { worldId, token } = await worldToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const turtle =
      'ex:Doc1 ex:title "First" ;\n  ex:body "zephyrquokka marker" .\nex:Doc2 ex:title "Second" ; ex:ref ex:Doc1 .';
    const imported = await json(
      await http(`https://data-qa.wazoo.dev/worlds/${worldId}/import`, {
        method: "POST",
        headers,
        body: JSON.stringify({ data: turtle }),
      }),
    );
    expect(imported.imported?.quads).toBe(4);
    const count = await json<{
      results?: { bindings?: { n?: { value?: string } }[] };
    }>(
      await http(`https://data-qa.wazoo.dev/worlds/${worldId}/sparql`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: "SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }",
        }),
      }),
    );
    expect(Number(count.results?.bindings?.[0]?.n?.value)).toBe(4);
    const exported = await http(
      `https://data-qa.wazoo.dev/worlds/${worldId}/export?format=text/turtle`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(await exported.text()).toContain("zephyrquokka marker");
    const search = await json(
      await http(`https://data-qa.wazoo.dev/worlds/${worldId}/search`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query: "zephyrquokka" }),
      }),
    );
    expect(search.mode).toBe("keyword");
    expect(
      (search.results as { text: string }[] | undefined)?.some((hit) =>
        hit.text.includes("zephyrquokka"),
      ),
    ).toBe(true);
  });

  it("counts chunks and JSON quads and exports them back", async () => {
    const { worldId, token } = await worldToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const chunks = await json(
      await http(`https://data-qa.wazoo.dev/worlds/${worldId}/import`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          contentType: "text/plain",
          data: "a\tone\nb\ttwo",
        }),
      }),
    );
    expect(chunks.imported?.chunks).toBe(2);
    const quads = await json(
      await http(`https://data-qa.wazoo.dev/worlds/${worldId}/import`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          contentType: "application/json",
          data: JSON.stringify([
            {
              subject: "urn:x:1",
              predicate: "http://schema.org/name",
              object: "One",
            },
            {
              subject: "urn:x:1",
              predicate: "http://schema.org/knows",
              object: "urn:x:2",
            },
          ]),
        }),
      }),
    );
    expect(quads.imported?.quads).toBe(2);
    const exported = await json(
      await http(
        `https://data-qa.wazoo.dev/worlds/${worldId}/export?format=application/json`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      ),
    );
    expect(exported.quads?.[0]?.subject).toBe("urn:x:1");
    const sparql = await json(
      await http(`https://data-qa.wazoo.dev/worlds/${worldId}/sparql`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: "ASK { <urn:x:1> <http://schema.org/knows> <urn:x:2> }",
        }),
      }),
    );
    expect(sparql.boolean).toBe(true);
  });

  it("denies cross-world tokens and namespace routes with a world key", async () => {
    const first = await worldToken();
    const second = await worldToken();
    const cross = await http(
      `https://data-qa.wazoo.dev/worlds/${first.worldId}/sparql`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${second.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: "SELECT * WHERE { ?s ?p ?o } LIMIT 1" }),
      },
    );
    expect(cross.status).toBe(401);
    expect(
      (
        await http("https://data-qa.wazoo.dev/worlds", {
          headers: { Authorization: `Bearer ${first.token}` },
        })
      ).status,
    ).toBe(403);
  });

  it("reports reindex completion with counts", async () => {
    const { worldId, token } = await worldToken();
    const reindex = await json(
      await http(`https://data-qa.wazoo.dev/worlds/${worldId}/reindex`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(reindex.status).toBe("completed");
    expect(reindex.processedQuadCount).toBeGreaterThanOrEqual(0);
    expect(reindex.chunkRowCount).toBeGreaterThan(0);
  });
});

describe("mock server: console", () => {
  it("serves /api/health and redirects /worlds", async () => {
    expect(
      (await json(await http("https://console-qa.wazoo.dev/api/health")))
        .status,
    ).toBe("ok");
    expect((await http("https://console-qa.wazoo.dev/worlds")).status).toBe(
      302,
    );
  });
});
