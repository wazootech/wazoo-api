#!/usr/bin/env node

/**
 * Credential-free platform canary. Read-only: GET requests only, no admin
 * token, no writes. Asserts that each deployed service is reachable, ready,
 * and that its protected routes reject unauthenticated callers.
 *
 * It does not prove secrets are correct. A bad secret fails the QA smoke gate
 * (`smoke:qa`) or surfaces as a runtime error; this canary only proves the
 * production deployment is up and enforcing its auth boundary.
 *
 * Env:
 *   CANARY_ENV      "prod" (default) or "qa"
 *   API_BASE_URL    override the management API base URL
 *   WORLDS_API_URL  override the data API base URL
 *   CONSOLE_URL     override the console base URL
 *
 * Exits non-zero if any assertion fails.
 */

const HOSTS = {
  prod: {
    api: "api.wazoo.dev",
    worlds: "data.wazoo.dev",
    console: "console.wazoo.dev",
  },
  qa: {
    api: "api-qa.wazoo.dev",
    worlds: "data-qa.wazoo.dev",
    console: "console-qa.wazoo.dev",
  },
};

const TIMEOUT_MS = 10_000;
const ATTEMPTS = 2;

const env = process.env.CANARY_ENV ?? "prod";
const hosts = HOSTS[env];
if (!hosts) {
  console.error(`CANARY_ENV must be "prod" or "qa", got "${env}"`);
  process.exit(1);
}

function target(name, override, hostname) {
  const value = override ?? `https://${hostname}`;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== hostname) {
    throw new Error(`${name} must be https://${hostname}, got ${value}`);
  }
  return url.origin;
}

let API, WORLDS, CONSOLE;
try {
  API = target("API_BASE_URL", process.env.API_BASE_URL, hosts.api);
  WORLDS = target("WORLDS_API_URL", process.env.WORLDS_API_URL, hosts.worlds);
  CONSOLE = target("CONSOLE_URL", process.env.CONSOLE_URL, hosts.console);
} catch (err) {
  console.error(String(err.message ?? err));
  process.exit(1);
}

async function get(url, init = {}) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function json(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

const checks = [
  ["api /health", async () => {
    const r = await get(`${API}/health`);
    const b = await json(r);
    return r.status === 200 && b?.status === "ok"
      ? null
      : `status ${r.status}, body.status ${String(b?.status)}`;
  }],
  ["api /ready", async () => {
    const r = await get(`${API}/ready`);
    const b = await json(r);
    return r.status === 200 && b?.status === "ready"
      ? null
      : `status ${r.status}, body.status ${String(b?.status)}`;
  }],
  ["api /openapi.json", async () => {
    const r = await get(`${API}/openapi.json`);
    const b = await json(r);
    return r.status === 200 && b?.openapi !== undefined && b?.paths !== undefined
      ? null
      : `status ${r.status}, not an OpenAPI document`;
  }],
  ["api rejects unauthenticated /v1/worlds", async () => {
    const r = await get(`${API}/v1/worlds`);
    return r.status === 401 ? null : `expected 401, got ${r.status}`;
  }],
  ["worlds /health", async () => {
    const r = await get(`${WORLDS}/health`);
    const b = await json(r);
    return r.status === 200 && b?.status === "ok"
      ? null
      : `status ${r.status}, body.status ${String(b?.status)}`;
  }],
  ["worlds /ready", async () => {
    const r = await get(`${WORLDS}/ready`);
    const b = await json(r);
    return r.status === 200 && b?.status === "ready"
      ? null
      : `status ${r.status}, body.status ${String(b?.status)}`;
  }],
  ["worlds /openapi.json", async () => {
    const r = await get(`${WORLDS}/openapi.json`);
    const b = await json(r);
    return r.status === 200 && b?.openapi !== undefined && b?.paths !== undefined
      ? null
      : `status ${r.status}, not an OpenAPI document`;
  }],
  ["worlds rejects unauthenticated /worlds", async () => {
    const r = await get(`${WORLDS}/worlds`);
    return r.status === 401 ? null : `expected 401, got ${r.status}`;
  }],
  ["console /api/health", async () => {
    const r = await get(`${CONSOLE}/api/health`);
    const b = await json(r);
    return r.status === 200 && b?.status === "ok"
      ? null
      : `status ${r.status}, body.status ${String(b?.status)}`;
  }],
  ["console redirects unauthenticated /worlds", async () => {
    const r = await get(`${CONSOLE}/worlds`, { redirect: "manual" });
    return r.status >= 300 && r.status < 400
      ? null
      : `expected 3xx, got ${r.status}`;
  }],
];

console.log(`Canary (${env}): ${API} / ${WORLDS} / ${CONSOLE}`);

let failed = 0;
for (const [name, run] of checks) {
  let problem;
  try {
    problem = await run();
  } catch (err) {
    problem = `request failed: ${String(err)}`;
  }
  if (problem) {
    failed++;
    console.error(`FAIL ${name}: ${problem}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

if (failed > 0) {
  console.error(`${failed} of ${checks.length} canary checks failed`);
  process.exit(1);
}
console.log(`all ${checks.length} canary checks passed`);
