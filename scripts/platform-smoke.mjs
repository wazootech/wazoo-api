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
 * WAZOO_SCRIPT_MODE=mock (or --dry-run) runs the whole gate against the
 * in-process mock server: no network, no credentials (wazoo-api#149).
 *
 * Exits non-zero if any assertion fails, so CI treats it as a gate. Driver
 * only; the tests live in scripts/platform-smoke/, shared helpers in
 * scripts/lib/.
 */

import { createNegativeChecks } from "./smoke-negative.mjs";
import { mockAwareFetch } from "./lib/http.mjs";
import { createPlatformMock } from "./lib/mock/index.mjs";
import { MOCK, runStamp } from "./lib/mode.mjs";
import { assertTarget } from "./lib/env.mjs";
import { requireReadiness } from "./platform-smoke/helpers.mjs";
import {
  testUnauthenticatedAppRedirect,
  testApiHealth,
  testOpenApiReachable,
  testUnauthenticatedApiCallsReturn401,
} from "./platform-smoke/tests.mjs";
import { testWorldLifecycle, testTokenManagement } from "./platform-smoke/lifecycle.mjs";
import { testSparqlQuery, cleanupWorld } from "./platform-smoke/data.mjs";

const API_BASE_URL = process.env.API_BASE_URL ?? "https://api-qa.wazoo.dev";
const WORLDS_API_URL = process.env.WORLDS_API_URL ?? "https://data-qa.wazoo.dev";
const CONSOLE_URL = process.env.CONSOLE_URL;
const ADMIN_TOKEN = process.env.WAZOO_PLATFORM_ADMIN_TOKEN;

if (!ADMIN_TOKEN && !MOCK) {
  console.error(
    "WAZOO_PLATFORM_ADMIN_TOKEN is required. Generate one via " +
      "`CLOUDFLARE_D1_DATABASE=wazoo-api-qa pnpm run launch:seed-admin-d1` " +
      "and export it before running the smoke gate.",
  );
  process.exit(1);
}
const ADMIN = ADMIN_TOKEN ?? "mock-admin-token";
const http = mockAwareFetch(
  createPlatformMock({
    api: API_BASE_URL,
    worlds: WORLDS_API_URL,
    console: CONSOLE_URL,
  }),
);

assertTarget("API_BASE_URL", API_BASE_URL, "api-qa.wazoo.dev");
assertTarget("WORLDS_API_URL", WORLDS_API_URL, "data-qa.wazoo.dev");
if (CONSOLE_URL) assertTarget("CONSOLE_URL", CONSOLE_URL, "console-qa.wazoo.dev");

const runId = runStamp();
const ownerEmail = `e2e+${runId}@wazoo.dev`;
const context = { http, API_BASE_URL, WORLDS_API_URL, CONSOLE_URL, ADMIN, runId, ownerEmail };

const negative = createNegativeChecks({
  apiUrl: API_BASE_URL,
  worldsUrl: WORLDS_API_URL,
  adminToken: ADMIN,
  ownerEmail,
  runId,
  fetchImpl: http,
});

console.log(
  `Smoke gate targets: ${API_BASE_URL} / ${WORLDS_API_URL}` +
    (CONSOLE_URL ? ` / ${CONSOLE_URL}` : ""),
);

const results = [];
await requireReadiness(context);
if (CONSOLE_URL) results.push(await testUnauthenticatedAppRedirect(context));
results.push(
  await testApiHealth(context),
  await testOpenApiReachable(context),
  await testUnauthenticatedApiCallsReturn401(context),
);

const lifecycle = await testWorldLifecycle(context);
results.push(lifecycle);
if (lifecycle.passed) {
  const token = await testTokenManagement(context, lifecycle.worldId);
  results.push(token);
  results.push(await testSparqlQuery(context, token.worldToken, token.worldId));
  results.push(
    await negative.testCrossWorldRevoke(token.worldId, token.worldTokenUid),
    await negative.testWorldKeyNamespaceRoutes(token.worldToken),
    await negative.testRemoteLoadDenied(token.worldToken, token.worldId),
  );
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
results.push(await negative.testTokenMintClamp());
results.push(await negative.cleanup());
results.push(await cleanupWorld(context, lifecycle.worldId));

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
