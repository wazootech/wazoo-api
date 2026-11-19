import { describe, expect, it, vi } from "vitest";

// The mock server and mock-aware fetch only engage in mock mode; pin it
// before the .mjs modules evaluate their mode constant.
vi.hoisted(() => {
  process.env.WAZOO_SCRIPT_MODE = "mock";
});
import {
  required,
  normalizeBaseUrl,
  assertTarget,
  assertCanaryTarget,
  // @ts-expect-error plain .mjs ops script without type declarations
} from "../scripts/lib/env.mjs";
import {
  parseJsonBody,
  Secrets,
  // @ts-expect-error plain .mjs ops script without type declarations
} from "../scripts/lib/http.mjs";
// @ts-expect-error plain .mjs ops script without type declarations
import { sparqlEngine } from "../scripts/lib/mock/sparql.mjs";
// @ts-expect-error plain .mjs ops script without type declarations
import { parseTurtleTriples } from "../scripts/lib/mock/turtle.mjs";
// @ts-expect-error plain .mjs ops script without type declarations
import { createMockState, userFor } from "../scripts/lib/mock/state.mjs";

describe("env helpers", () => {
  it("required throws the shared wording", () => {
    delete process.env.WAZOO_TEST_MISSING;
    expect(() => required("WAZOO_TEST_MISSING")).toThrow(
      "Missing required environment variable: WAZOO_TEST_MISSING",
    );
  });

  it("normalizeBaseUrl keeps private-beta-health's trailing-/v1 rule", () => {
    expect(normalizeBaseUrl("http://localhost:8787")).toBe(
      "http://localhost:8787/",
    );
    expect(normalizeBaseUrl("https://api.wazoo.dev/v1/")).toBe(
      "https://api.wazoo.dev/",
    );
  });

  it("assertTarget allows the named host or local HTTP only", () => {
    expect(() =>
      assertTarget("X", "http://evil.dev", "api-qa.wazoo.dev"),
    ).toThrow(/must be over HTTPS/);
    expect(
      assertTarget("X", "https://api-qa.wazoo.dev", "api-qa.wazoo.dev"),
    ).toBe("https://api-qa.wazoo.dev");
    expect(assertTarget("X", "http://127.0.0.1:8787", "api-qa.wazoo.dev")).toBe(
      "http://127.0.0.1:8787",
    );
  });

  it("assertCanaryTarget refuses local overrides", () => {
    expect(() =>
      assertCanaryTarget("X", "http://api.wazoo.dev", "api.wazoo.dev"),
    ).toThrow(/must be https:\/\/api\.wazoo\.dev/);
  });
});

describe("http helpers", () => {
  it("parseJsonBody returns null for empty text and text for non-JSON", () => {
    expect(parseJsonBody("")).toBeNull();
    expect(parseJsonBody('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonBody("plain")).toBe("plain");
  });

  it("Secrets.redact scrubs recorded tokens from strings and JSON", () => {
    const secrets = new Secrets();
    secrets.add("wzp_supersecret");
    expect(secrets.redact("Bearer wzp_supersecret here")).toBe(
      "Bearer [redacted] here",
    );
    expect(secrets.redact({ token: "wzp_supersecret" })).toBe(
      '{"token":"[redacted]"}',
    );
  });
});

describe("mock state", () => {
  it("issues canonical world ids and stable users", () => {
    const state = createMockState();
    const user = userFor(state, "e2e+run@wazoo.dev");
    expect(user.uid).toBe("uid-1");
    expect(userFor(state, "e2e+run@wazoo.dev")).toBe(user);
    expect(state.worldId()).toMatch(/^w_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
  });
});

describe("turtle parser", () => {
  it("carries subjects across ; and . like the round trip fixture", () => {
    const turtle = `@prefix ex: <http://example.org/> .
ex:Doc1 ex:title "First" ;
  ex:body "Second keyword" .
ex:Doc2 ex:title "Third" ; ex:ref ex:Doc1 .`;
    expect(parseTurtleTriples(turtle)).toEqual([
      ["ex:Doc1", "ex:title", "First"],
      ["ex:Doc1", "ex:body", "Second keyword"],
      ["ex:Doc2", "ex:title", "Third"],
      ["ex:Doc2", "ex:ref", "ex:Doc1"],
    ]);
  });
});

describe("sparql engine", () => {
  const world = { triples: [["ex:Alice", "ex:name", "Alice"]] };
  const engine = () => sparqlEngine(world);

  it("inserts and selects bindings", () => {
    expect(engine()(`INSERT DATA { ex:Bob ex:name "Bob" . }`).status).toBe(200);
    const res = engine()("SELECT ?name WHERE { ex:Bob ex:name ?name }");
    expect(res.json.results.bindings).toEqual([
      { name: { type: "literal", value: "Bob" } },
    ]);
  });

  it("answers COUNT, ASK and iri patterns", () => {
    const count = engine()("SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }");
    expect(count.json.results.bindings[0].n.value).toBe("2");
    expect(engine()('ASK { ex:Alice ex:name "Alice" }').json.boolean).toBe(
      true,
    );
    const iri = engine()("SELECT ?o WHERE { <ex:Alice> <ex:name> ?o }");
    expect(iri.json.results.bindings[0].o.value).toBe("Alice");
  });

  it("refuses remote LOAD with a policy error and leaves the graph empty", () => {
    const load = engine()(`LOAD <http://169.254.169.254/x> INTO GRAPH <urn:g>`);
    expect(load.status).toBe(400);
    expect(load.text).toMatch(/policy/);
    const ask = engine()("ASK { GRAPH <urn:g> { ?s ?p ?o } }");
    expect(ask.json.boolean).toBe(false);
  });

  it("400s on unrecognized queries", () => {
    expect(engine()("DESCRIBE <ex:Alice>").status).toBe(400);
  });
});
