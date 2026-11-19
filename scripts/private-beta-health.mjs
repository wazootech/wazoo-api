#!/usr/bin/env node

// Private beta health test: exercises the platform and data planes end to end
// with a throwaway user and worlds. WAZOO_SCRIPT_MODE=mock (or --dry-run)
// runs the whole flow against the in-process mock server: no network, no
// credentials (wazoo-api#149). Driver only; the steps live in
// scripts/private-beta-health/, the request plumbing in its client.mjs.
import { mockAwareFetch } from "./lib/http.mjs";
import { createPlatformMock } from "./lib/mock/index.mjs";
import { normalizeBaseUrl } from "./lib/env.mjs";
import { MOCK, runStamp36 } from "./lib/mode.mjs";
import { apiRequest, worldsRequest } from "./private-beta-health/client.mjs";
import {
  ensureUser,
  createWorld,
  createWorldToken,
  revokeWorldToken,
  deleteWorld,
  undeleteWorld,
} from "./private-beta-health/steps-world.mjs";
import {
  importChunks,
  importQuads,
  searchWorld,
  exportChunks,
  exportQuads,
  sparqlSelect,
  sparqlAsk,
} from "./private-beta-health/steps-data.mjs";
import {
  recordUsage,
  readUsage,
  readLimits,
  readBilling,
} from "./private-beta-health/steps-metering.mjs";

const apiBaseUrl = normalizeBaseUrl(
  process.env.API_BASE_URL ?? "http://localhost:8787",
);
const worldsBaseUrl = normalizeBaseUrl(
  process.env.WORLDS_API_URL ?? "https://data.wazoo.dev",
);
const adminToken = MOCK
  ? "mock-admin-token"
  : required("WAZOO_PLATFORM_ADMIN_TOKEN");
const runId = process.env.WAZOO_HEALTH_RUN_ID ?? runStamp36();
const email = process.env.WAZOO_HEALTH_EMAIL ?? `health+${runId}@wazoo.dev`;
const worldNames = [
  process.env.WAZOO_HEALTH_WORLD ?? `health-${runId}`,
  process.env.WAZOO_HEALTH_WORLD_2 ?? `health-${runId}-b`,
];

// The shared mock server stands in for both planes in mock mode.
const http = mockAwareFetch(
  createPlatformMock({ api: apiBaseUrl, worlds: worldsBaseUrl }),
);

const context = {
  http,
  apiBaseUrl,
  worldsBaseUrl,
  adminToken,
  runId,
  email,
  worldNames,
  state: {
    userUid: null,
    worldId: null,
    worldByName: {},
    worldTokenUid: null,
    worldToken: null,
  },
};
const { state } = context;

async function step(name, action) {
  process.stdout.write(`- ${name}... `);
  const response = await action();
  console.log(response?.status ?? "ok");
  return response;
}

function fail(message) {
  console.error(`\nPrivate beta health test failed: ${message}`);
  process.exit(1);
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    fail(`Missing required environment variable: ${name}`);
  }
  return value;
}

try {
  await step("platform health", () => apiRequest(context)("/health", { auth: false }));
  await step("platform readiness", () => apiRequest(context)("/ready", { auth: false }));
  await step("worlds health", () => worldsRequest(context)("/health", { auth: false }));
  await step("worlds readiness", () =>
    worldsRequest(context)("/ready", { auth: false }),
  );

  await step("ensure test user", () => ensureUser(context));
  await step("create first world", () => createWorld(context, worldNames[0]));
  await step("create second world", () => createWorld(context, worldNames[1]));
  await step("list worlds", () =>
    apiRequest(context)(`/v1/worlds?email=${encodeURIComponent(email)}`),
  );
  await step("get world", () =>
    apiRequest(context)(
      `/v1/worlds/${state.worldId}?email=${encodeURIComponent(email)}`,
    ),
  );
  await step("create world token", () => createWorldToken(context));
  await step("import chunks", () => importChunks(context));
  await step("import quads", () => importQuads(context));
  await step("search world", () => searchWorld(context));
  await step("export chunks", () => exportChunks(context));
  await step("export quads", () => exportQuads(context));
  await step("sparql select", () => sparqlSelect(context));
  await step("sparql ask", () => sparqlAsk(context));
  await step("record usage", () => recordUsage(context));
  await step("read usage", () => readUsage(context));
  await step("read limits", () => readLimits(context));
  await step("read billing", () => readBilling(context));
  await step("revoke world token", () => revokeWorldToken(context));
  await step("soft-delete first world", () =>
    deleteWorld(context, state.worldByName[worldNames[0]]),
  );
  await step("undelete first world", () =>
    undeleteWorld(context, state.worldByName[worldNames[0]]),
  );
  await step("final soft-delete first world", () =>
    deleteWorld(context, state.worldByName[worldNames[0]]),
  );
  await step("final soft-delete second world", () =>
    deleteWorld(context, state.worldByName[worldNames[1]]),
  );

  console.log(
    `\nPrivate beta health test passed for user ${email} and worlds ${worldNames.join(", ")}`,
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
