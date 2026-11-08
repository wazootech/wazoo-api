import { describe, expect, it } from "vitest";
import {
  createNegativeChecks,
  LOAD_TARGET,
  // @ts-expect-error plain .mjs ops script without type declarations
} from "../scripts/smoke-negative.mjs";

// Fake fixture values only; fetch is mocked, nothing leaves the process.
type Call = { method: string; url: string; auth: string; body: string };
type Mode = "strict" | "permissive";

function mockFetch(mode: Mode) {
  const calls: Call[] = [];
  const strict = mode === "strict";
  const reply = (status: number, body: unknown = {}) =>
    new Response(JSON.stringify(body), { status });
  const impl = async (input: string, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const auth = String(
      (init.headers as Record<string, string>)?.Authorization,
    );
    const body = String(init.body ?? "");
    calls.push({ method, url, auth, body });
    const limited = auth === "Bearer limited-token";
    if (method === "DELETE") {
      return url.includes("/auth/tokens/") && strict
        ? reply(404)
        : new Response(null, { status: 204 });
    }
    if (url.endsWith("/v1/auth/api-tokens")) {
      if (limited) return strict ? reply(403) : reply(201, { token: "x" });
      return reply(201, { token: "limited-token" });
    }
    if (url.endsWith("/v1/worlds"))
      return reply(201, { world: { id: "w_other" } });
    if (url.endsWith("/worlds")) {
      return strict
        ? reply(403)
        : reply(method === "POST" ? 201 : 200, { id: "w_leak" });
    }
    if (url.endsWith("/sparql")) {
      if (body.includes("LOAD")) {
        return strict
          ? new Response("LOAD of a remote URL is not permitted by policy", {
              status: 400,
            })
          : reply(200);
      }
      return reply(200, { boolean: !strict });
    }
    return reply(500);
  };
  return { impl, calls };
}

function setup(mode: Mode) {
  const { impl, calls } = mockFetch(mode);
  const checks = createNegativeChecks({
    apiUrl: "https://api.invalid",
    worldsUrl: "https://data.invalid",
    adminToken: "admin-token",
    ownerEmail: "o@example.com",
    runId: "1",
    fetchImpl: impl,
  });
  return { checks, calls };
}

describe("negative smoke assertions", () => {
  it("pass when every protection refuses", async () => {
    const { checks } = setup("strict");
    const results = [
      await checks.testTokenMintClamp(),
      await checks.testCrossWorldRevoke("w_a", "uid1"),
      await checks.testWorldKeyNamespaceRoutes("wzw_x"),
      await checks.testRemoteLoadDenied("wzw_x", "w_a"),
      await checks.cleanup(),
    ];
    expect(results.filter((r: { passed: boolean }) => !r.passed)).toEqual([]);
  });

  it("fail when the protections are missing", async () => {
    const { checks, calls } = setup("permissive");
    const results = [
      await checks.testTokenMintClamp(),
      await checks.testCrossWorldRevoke("w_a", "uid1"),
      await checks.testWorldKeyNamespaceRoutes("wzw_x"),
      await checks.testRemoteLoadDenied("wzw_x", "w_a"),
    ];
    expect(results.map((r: { passed: boolean }) => r.passed)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    // Fixtures minted or leaked by a failing run are still removed.
    await checks.cleanup();
    const deleted = calls
      .filter((c) => c.method === "DELETE")
      .map((c) => c.url);
    expect(
      deleted.some((u) => u.includes("/auth/api-tokens/smoke-wide-1")),
    ).toBe(true);
    expect(deleted.some((u) => u.includes("/v1/worlds/w_leak"))).toBe(true);
  });

  it("LOAD uses an internal address and never a real host", () => {
    expect(LOAD_TARGET).toBe("http://169.254.169.254/x");
  });
});
