// Local health test for wazoo-api
// Usage: node scripts/local-health.mjs [baseUrl]
//   Defaults to http://localhost:8787 for wrangler dev
//   Set WAZOO_PLATFORM_ADMIN_TOKEN env var for authenticated tests
// WAZOO_SCRIPT_MODE=mock (or --dry-run) runs the whole flow against the
// in-process mock server: no network, no credentials (wazoo-api#149).
//
// Driver only; the tests live in scripts/local-health/, shared helpers in
// scripts/lib/.
import { mockAwareFetch } from "./lib/http.mjs";
import { createPlatformMock } from "./lib/mock/index.mjs";
import { MOCK, runStamp } from "./lib/mode.mjs";
import { randomWorldId } from "./lib/world-id.mjs";
import { assertOk } from "./local-health/assert.mjs";
import {
  testHealth,
  testOpenApi,
  testAuthValidation,
  testSchemaValidation,
} from "./local-health/tests-schema.mjs";
import { testAuthenticatedFlow } from "./local-health/tests-flow.mjs";
import { testWorldDeleteAndTokens } from "./local-health/tests-tokens.mjs";

const BASE_URL = process.argv.filter((arg) => arg !== "--dry-run")[2] ?? "http://localhost:8787";
try {
  const url = new URL(BASE_URL);
  if (
    !(
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    ) &&
    !(url.protocol === "https:" && url.hostname === "api-qa.wazoo.dev")
  ) {
    throw new Error(
      `BASE_URL must be http://localhost, http://127.0.0.1, or https://api-qa.wazoo.dev`,
    );
  }
} catch (err) {
  throw new Error(
    `BASE_URL must be http://localhost, http://127.0.0.1, or https://api-qa.wazoo.dev`,
    { cause: err },
  );
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const ADMIN_TOKEN = MOCK
  ? "mock-admin-token"
  : required("WAZOO_PLATFORM_ADMIN_TOKEN");

// The shared mock server stands in for the API in mock mode.
const http = mockAwareFetch(
  createPlatformMock({ api: BASE_URL, worlds: BASE_URL }),
);

const context = {
  http,
  BASE_URL,
  ADMIN_TOKEN,
  testEmail: `health-${runStamp()}@wazoo.dev`,
  testWorldId: randomWorldId(),
  randomWorldId,
  passed: 0,
  failed: 0,
};

async function test(name, fn) {
  try {
    await fn();
    context.passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    context.failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
  }
}
context.test = test;

// ── Start ──

console.log(`\nWazoo API local health test`);
console.log(`  Base URL: ${BASE_URL}`);
console.log(
  `  Admin token: ${ADMIN_TOKEN ? "set" : "NOT SET (auth tests skipped)"}\n`,
);

const readyResponse = await http(`${BASE_URL}/ready`);
await assertOk(readyResponse);
const readyBody = await readyResponse.json();
if (readyBody.status !== "ready") {
  throw new Error(`Readiness preflight failed: status is ${readyBody.status}`);
}
console.log(`  PASS  GET /ready confirms canonical world identity schema`);

// ── Health ───

await testHealth(context);
await testOpenApi(context);

// ── Auth validation ───

await testAuthValidation(context);
await testSchemaValidation(context);

// ── Authenticated health flow (requires admin token) ───

await testAuthenticatedFlow(context);
await testWorldDeleteAndTokens(context);

// ── Results ───

console.log(
  `\n${context.passed} passed, ${context.failed} failed, ${context.passed + context.failed} total\n`,
);
process.exit(context.failed > 0 ? 1 : 0);
