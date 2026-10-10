#!/usr/bin/env node

/**
 * Live platform smoke gate (defaults to QA). Owns the deployed platform
 * contract: control plane (wazoo-api), data plane (worlds-api), and console
 * reachability. This is the wazoo-api home of the assertions that previously
 * lived in wazoo-e2e, so the move does not change what the gate verifies.
 *
 * Env:
 *   API_BASE_URL               default https://api-qa.wazoo.dev
 *   WORLDS_API_URL             default https://data-qa.wazoo.dev
 *   CONSOLE_URL                optional; enables console redirect + /api/health checks
 *   WAZOO_PLATFORM_ADMIN_TOKEN required
 *
 * Exits non-zero if any assertion fails, so CI treats it as a gate.
 */

const API_BASE_URL = process.env.API_BASE_URL ?? "https://api-qa.wazoo.dev";
const WORLDS_API_URL = process.env.WORLDS_API_URL ?? "https://data-qa.wazoo.dev";
const CONSOLE_URL = process.env.CONSOLE_URL;
const ADMIN_TOKEN = process.env.WAZOO_PLATFORM_ADMIN_TOKEN;

function assertSmokeTarget(name, value, qaHostname) {
  const url = new URL(value);
  const isLocalHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  const isQaHttps = url.protocol === "https:" && url.hostname === qaHostname;
  if (!isLocalHttp && !isQaHttps) {
    throw new Error(
      `Smoke target ${name} must be over HTTPS to ${qaHostname} or local HTTP, got ${value}`,
    );
  }
}

if (!ADMIN_TOKEN) {
  console.error(
    "WAZOO_PLATFORM_ADMIN_TOKEN is required. Generate one via " +
      "`CLOUDFLARE_D1_DATABASE=wazoo-api-qa pnpm run launch:seed-admin-d1` " +
      "and export it before running the smoke gate.",
  );
  process.exit(1);
}

assertSmokeTarget("API_BASE_URL", API_BASE_URL, "api-qa.wazoo.dev");
assertSmokeTarget("WORLDS_API_URL", WORLDS_API_URL, "data-qa.wazoo.dev");
if (CONSOLE_URL) assertSmokeTarget("CONSOLE_URL", CONSOLE_URL, "console-qa.wazoo.dev");

const runId = Date.now().toString();
const ownerEmail = `e2e+${runId}@wazoo.dev`;

console.log(
  `Smoke gate targets: ${API_BASE_URL} / ${WORLDS_API_URL}` +
    (CONSOLE_URL ? ` / ${CONSOLE_URL}` : ""),
);

async function jsonOrNull(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function requireReadiness() {
  const targets = [
    { name: "API_BASE_URL", url: `${API_BASE_URL}/ready` },
    { name: "WORLDS_API_URL", url: `${WORLDS_API_URL}/ready` },
  ];
  for (const { name, url } of targets) {
    const response = await fetch(url);
    const body = await jsonOrNull(response);
    if (response.status !== 200 || body?.status !== "ready") {
      console.error(
        `Smoke run aborted before writes: readiness failed for ${name}`,
      );
      process.exit(1);
    }
  }
}

async function check(name, fn) {
  try {
    return await fn();
  } catch (err) {
    return { name, passed: false, detail: String(err) };
  }
}

async function testUnauthenticatedAppRedirect() {
  return check("testUnauthenticatedAppRedirect", async () => {
    const response = await fetch(`${CONSOLE_URL}/worlds`, {
      redirect: "manual",
    });
    const passed = response.status >= 300 && response.status < 400;
    return {
      name: "testUnauthenticatedAppRedirect",
      passed,
      detail: passed
        ? `unauthenticated /worlds redirects (${response.status})`
        : `expected 3xx redirect from /worlds, got ${response.status}`,
    };
  });
}

async function testApiHealth() {
  return check("testApiHealth", async () => {
    const urls = [
      `${API_BASE_URL}/health`,
      `${WORLDS_API_URL}/health`,
      ...(CONSOLE_URL ? [`${CONSOLE_URL}/api/health`] : []),
    ];
    for (const url of urls) {
      const response = await fetch(url);
      if (response.status !== 200) {
        return {
          name: "testApiHealth",
          passed: false,
          detail: `expected 200 from ${url}, got ${response.status}`,
        };
      }
      const body = await jsonOrNull(response);
      if (body?.status !== "ok") {
        return {
          name: "testApiHealth",
          passed: false,
          detail: `expected status ok from ${url}, got ${String(body?.status)}`,
        };
      }
    }
    return { name: "testApiHealth", passed: true, detail: "health endpoints report ok" };
  });
}

async function testOpenApiReachable() {
  return check("testOpenApiReachable", async () => {
    const urls = [
      `${API_BASE_URL}/openapi.json`,
      `${WORLDS_API_URL}/openapi.json`,
    ];
    for (const url of urls) {
      const response = await fetch(url);
      if (response.status !== 200) {
        return {
          name: "testOpenApiReachable",
          passed: false,
          detail: `expected 200 from ${url}, got ${response.status}`,
        };
      }
      const body = await jsonOrNull(response);
      if (body?.openapi === undefined || body?.paths === undefined) {
        return {
          name: "testOpenApiReachable",
          passed: false,
          detail: `openapi.json from ${url} missing openapi/paths`,
        };
      }
    }
    return { name: "testOpenApiReachable", passed: true, detail: "OpenAPI specs reachable" };
  });
}

async function testUnauthenticatedApiCallsReturn401() {
  return check("testUnauthenticatedApiCallsReturn401", async () => {
    const apiResponse = await fetch(`${API_BASE_URL}/v1/worlds`);
    if (apiResponse.status !== 401) {
      return {
        name: "testUnauthenticatedApiCallsReturn401",
        passed: false,
        detail: `expected 401 from ${API_BASE_URL}/v1/worlds, got ${apiResponse.status}`,
      };
    }
    const worldsResponse = await fetch(`${WORLDS_API_URL}/worlds`);
    if (worldsResponse.status !== 401) {
      return {
        name: "testUnauthenticatedApiCallsReturn401",
        passed: false,
        detail: `expected 401 from ${WORLDS_API_URL}/worlds, got ${worldsResponse.status}`,
      };
    }
    return {
      name: "testUnauthenticatedApiCallsReturn401",
      passed: true,
      detail: "unauthenticated API calls return 401",
    };
  });
}

async function testWorldLifecycle() {
  return check("testWorldLifecycle", async () => {
    const userResponse = await fetch(
      `${API_BASE_URL}/v1/users/me?email=${encodeURIComponent(ownerEmail)}`,
      { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } },
    );
    if (userResponse.status < 200 || userResponse.status >= 300) {
      return {
        name: "testWorldLifecycle",
        passed: false,
        detail: `ensure user: expected 2xx, got ${userResponse.status}`,
      };
    }

    const createResponse = await fetch(`${API_BASE_URL}/v1/worlds`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ownerEmail,
        world: { displayName: `E2E Test ${runId}`, region: "auto" },
      }),
    });
    if (createResponse.status !== 201) {
      return {
        name: "testWorldLifecycle",
        passed: false,
        detail: `create world: expected 201, got ${createResponse.status}`,
      };
    }
    const created = await jsonOrNull(createResponse);
    if (created?.world?.state !== "ACTIVE") {
      return {
        name: "testWorldLifecycle",
        passed: false,
        detail: `create world: expected state ACTIVE, got ${created?.world?.state}`,
      };
    }
    const worldId = created.world?.id;
    if (
      typeof worldId !== "string" ||
      !/^w_[0-7][0-9a-hjkmnp-tv-z]{25}$/.test(worldId)
    ) {
      return {
        name: "testWorldLifecycle",
        passed: false,
        detail: "create world: response did not include a canonical world.id",
      };
    }
    const detail = `world created, ACTIVE, id ${worldId}`;
    return { name: "testWorldLifecycle", passed: true, detail, worldId };
  });
}

async function testTokenManagement(worldId) {
  return check("testTokenManagement", async () => {
    const tokenResponse = await fetch(
      `${API_BASE_URL}/v1/worlds/${worldId}/auth/tokens?email=${encodeURIComponent(ownerEmail)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ADMIN_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "e2e-test-token" }),
      },
    );
    if (tokenResponse.status !== 201) {
      return {
        name: "testTokenManagement",
        passed: false,
        detail: `create token: expected 201, got ${tokenResponse.status}`,
      };
    }
    const body = await jsonOrNull(tokenResponse);
    const worldToken = body?.token?.token;
    if (!worldToken) {
      return {
        name: "testTokenManagement",
        passed: false,
        detail: "create token: response did not include token secret",
      };
    }
    return {
      name: "testTokenManagement",
      passed: true,
      detail: `world auth token minted (${worldToken.slice(0, 12)}...)`,
      worldToken,
      worldId,
    };
  });
}

async function testSparqlQuery(worldToken, canonicalId) {
  return check("testSparqlQuery", async () => {
    if (!worldToken) {
      return {
        name: "testSparqlQuery",
        passed: false,
        detail: "no world token on context; run testTokenManagement first",
      };
    }
    const worldId = canonicalId;
    if (!worldId) {
      return {
        name: "testSparqlQuery",
        passed: false,
        detail: "no canonical world ID on context",
      };
    }
    const headers = {
      Authorization: `Bearer ${worldToken}`,
      "Content-Type": "application/json",
    };
    const insertResponse = await fetch(
      `${WORLDS_API_URL}/worlds/${worldId}/sparql`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: `PREFIX ex: <http://example.org/>
INSERT DATA {
  ex:Alice ex:name "Alice" ;
           ex:age "30" ;
           ex:city "Portland" .
}`,
        }),
      },
    );
    if (insertResponse.status !== 200) {
      return {
        name: "testSparqlQuery",
        passed: false,
        detail: `sparql insert: expected 200, got ${insertResponse.status}`,
      };
    }
    const selectResponse = await fetch(
      `${WORLDS_API_URL}/worlds/${worldId}/sparql`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: `PREFIX ex: <http://example.org/>
SELECT ?name ?age ?city WHERE {
  ex:Alice ex:name ?name ;
           ex:age ?age ;
           ex:city ?city .
}`,
        }),
      },
    );
    if (selectResponse.status !== 200) {
      return {
        name: "testSparqlQuery",
        passed: false,
        detail: `sparql select: expected 200, got ${selectResponse.status}`,
      };
    }
    const result = await jsonOrNull(selectResponse);
    const bindings = result?.results?.bindings;
    if (!bindings || bindings.length < 1) {
      return {
        name: "testSparqlQuery",
        passed: false,
        detail: "sparql select: no bindings returned",
      };
    }
    const first = bindings[0];
    for (const [key, expected] of [
      ["name", "Alice"],
      ["age", "30"],
      ["city", "Portland"],
    ]) {
      if (first[key]?.value !== expected) {
        return {
          name: "testSparqlQuery",
          passed: false,
          detail: `sparql select: expected ${key}=${expected}, got ${first[key]?.value}`,
        };
      }
    }
    return {
      name: "testSparqlQuery",
      passed: true,
      detail: "SPARQL insert + select round-tripped correctly",
    };
  });
}

async function cleanupWorld(worldId) {
  return check("cleanupWorld", async () => {
    if (!worldId) {
      return {
        name: "cleanupWorld",
        passed: true,
        detail: "no canonical world ID was created; cleanup skipped",
      };
    }
    const response = await fetch(
      `${API_BASE_URL}/v1/worlds/${worldId}?email=${encodeURIComponent(ownerEmail)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } },
    );
    const passed = response.ok || response.status === 404;
    return {
      name: "cleanupWorld",
      passed,
      detail: passed
        ? response.status === 404
          ? `world ${worldId} did not exist; nothing to delete`
          : `deleted world ${worldId}`
        : `delete world: expected ok or 404, got ${response.status}`,
    };
  });
}

const results = [];
await requireReadiness();
if (CONSOLE_URL) results.push(await testUnauthenticatedAppRedirect());
results.push(
  await testApiHealth(),
  await testOpenApiReachable(),
  await testUnauthenticatedApiCallsReturn401(),
);

const lifecycle = await testWorldLifecycle();
results.push(lifecycle);
if (lifecycle.passed) {
  const token = await testTokenManagement(lifecycle.worldId);
  results.push(token);
  results.push(await testSparqlQuery(token.worldToken, token.worldId));
} else {
  results.push(
    {
      name: "testTokenManagement",
      passed: false,
      detail: "skipped: world lifecycle failed",
    },
    {
      name: "testSparqlQuery",
      passed: false,
      detail: "skipped: world lifecycle failed",
    },
  );
}
results.push(await cleanupWorld(lifecycle.worldId));

let failed = false;
for (const result of results) {
  const icon = result.passed ? "PASS" : "FAIL";
  console.log(`${icon}  ${result.name}: ${result.detail}`);
  if (!result.passed) failed = true;
}

if (failed) {
  console.error("Smoke gate failed.");
  process.exit(1);
}
console.log("Smoke gate passed.");