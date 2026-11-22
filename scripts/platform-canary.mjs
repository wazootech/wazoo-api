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
 *
 * WAZOO_SCRIPT_MODE=mock (or --dry-run) runs the checks against the in-process
 * mock server: no network, no credentials (wazoo-api#149). Driver only; the
 * checks live in scripts/platform-canary/checks.mjs.
 */

import { mockAwareFetch } from "./lib/http.mjs";
import { createPlatformMock } from "./lib/mock/index.mjs";
import { canaryChecks } from "./platform-canary/checks.mjs";

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

const http = mockAwareFetch(
  createPlatformMock({ api: API, worlds: WORLDS, console: CONSOLE }),
);

async function get(url, init = {}) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      return await http(url, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}


console.log(`Canary (${env}): ${API} / ${WORLDS} / ${CONSOLE}`);

const checks = canaryChecks({ API, WORLDS, CONSOLE, get });

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
