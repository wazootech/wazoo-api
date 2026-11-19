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
