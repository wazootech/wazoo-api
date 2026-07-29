#!/usr/bin/env node

const apiBaseUrl = normalizeBaseUrl(
  process.env.API_BASE_URL ?? "http://localhost:8787",
);
const worldsBaseUrl = normalizeBaseUrl(
  process.env.WORLDS_API_URL ?? "https://worlds-api.wazoo.dev",
);
const adminToken =
  process.env.WAZOO_ADMIN_TOKEN ?? process.env.WAZOO_PLATFORM_TOKEN;
const runId = process.env.WAZOO_HEALTH_RUN_ID ?? Date.now().toString(36);
const email = process.env.WAZOO_HEALTH_EMAIL ?? `health+${runId}@wazoo.dev`;
const worldIds = [
  process.env.WAZOO_HEALTH_WORLD ?? `health-${runId}`,
  process.env.WAZOO_HEALTH_WORLD_2 ?? `health-${runId}-b`,
];

if (!adminToken) {
  fail(
    "Set WAZOO_ADMIN_TOKEN to a global admin platform token before running the health test.",
  );
}

const state = { userUid: null, worldTokenUid: null, worldToken: null };

try {
  await step("platform health", () => apiRequest("/health", { auth: false }));
  await step("worlds health", () => worldsRequest("/health", { auth: false }));
  await step("ensure test user", ensureUser);
  await step("create first world", () => createWorld(worldIds[0]));
  await step("create second world", () => createWorld(worldIds[1]));
  await step("list worlds", () =>
    apiRequest(`/v1/worlds?email=${encodeURIComponent(email)}`),
  );
  await step("get world", () =>
    apiRequest(`/v1/worlds/${worldIds[0]}?email=${encodeURIComponent(email)}`),
  );
  await step("sync world", () =>
    apiRequest(
      `/v1/worlds/${worldIds[0]}/sync?email=${encodeURIComponent(email)}`,
      { method: "POST" },
    ),
  );
  await step("create world token", createWorldToken);
  await step("import chunks", importChunks);
  await step("import quads", importQuads);
  await step("search world", searchWorld);
  await step("export chunks", exportChunks);
  await step("export quads", exportQuads);
  await step("sparql select", sparqlSelect);
  await step("sparql ask", sparqlAsk);
  await step("record usage", () =>
    apiRequest(`/v1/worlds/${worldIds[0]}/usage`, {
      method: "POST",
      body: {
        email,
        metric: "health.requests",
        quantity: 1,
        unit: "request",
      },
    }),
  );
  await step("read usage", () =>
    apiRequest(
      `/v1/worlds/${worldIds[0]}/usage?email=${encodeURIComponent(email)}`,
    ),
  );
  await step("read limits", () =>
    apiRequest(
      `/v1/worlds/${worldIds[0]}/limits?email=${encodeURIComponent(email)}`,
    ),
  );
  await step("read billing", () =>
    apiRequest(
      `/v1/worlds/${worldIds[0]}/billing?email=${encodeURIComponent(email)}`,
    ),
  );
  await step("revoke world token", revokeWorldToken);
  await step("soft-delete first world", () => deleteWorld(worldIds[0]));
  await step("undelete first world", () => undeleteWorld(worldIds[0]));
  await step("final soft-delete first world", () => deleteWorld(worldIds[0]));
  await step("final soft-delete second world", () => deleteWorld(worldIds[1]));

  console.log(
    `\nPrivate beta health test passed for user ${email} and worlds ${worldIds.join(", ")}`,
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

async function ensureUser() {
  const response = await apiRequest(
    `/v1/users/me?email=${encodeURIComponent(email)}`,
    { allowStatus: [200, 201] },
  );
  state.userUid = response.body.user.uid;
  assert(response.body.user.email === email, "Test user email mismatch");
  return response;
}

async function createWorld(worldId) {
  const response = await apiRequest("/v1/worlds", {
    method: "POST",
    body: {
      ownerEmail: email,
      worldId,
      world: { displayName: `Health World ${worldId}` },
    },
  });
  assert(
    response.body.world.worldId === worldId,
    `World ${worldId} was not created`,
  );
  return response;
}

async function createWorldToken() {
  const response = await apiRequest(
    `/v1/worlds/${worldIds[0]}/auth/tokens?email=${encodeURIComponent(email)}`,
    {
      method: "POST",
      body: { name: `health-${runId}` },
    },
  );
  state.worldTokenUid = response.body.token.uid;
  state.worldToken = response.body.token.token;
  assert(state.worldToken?.startsWith("wzw_"), "World token was not returned");
  return response;
}

async function importChunks() {
  const response = await worldsRequest(`/worlds/${worldIds[0]}/import`, {
    method: "POST",
    body: {
      contentType: "text/plain",
      data: `health:alpha\tWazoo health alpha ${runId}\nhealth:beta\tWazoo health beta ${runId}`,
    },
  });
  assert(response.body.imported.chunks === 2, "Chunk import count mismatch");
  return response;
}

async function importQuads() {
  const response = await worldsRequest(`/worlds/${worldIds[0]}/import`, {
    method: "POST",
    body: {
      contentType: "application/json",
      data: JSON.stringify([
        {
          subject: `urn:wazoo:health:${runId}:alpha`,
          predicate: "http://schema.org/name",
          object: `Alpha ${runId}`,
        },
        {
          subject: `urn:wazoo:health:${runId}:alpha`,
          predicate: "http://schema.org/knows",
          object: `urn:wazoo:health:${runId}:beta`,
        },
      ]),
    },
  });
  assert(response.body.imported.quads === 2, "Quad import count mismatch");
  return response;
}

async function searchWorld() {
  const response = await worldsRequest(`/worlds/${worldIds[0]}/search`, {
    method: "POST",
    body: { query: `alpha ${runId}`, limit: 5 },
  });
  assert(response.body.results.length > 0, "Search returned no results");
  return response;
}

async function exportChunks() {
  const response = await worldsRequest(
    `/worlds/${worldIds[0]}/export?format=text/plain`,
  );
  assert(
    String(response.body).includes(`Wazoo health alpha ${runId}`),
    "Chunk export missing alpha text",
  );
  return response;
}

async function exportQuads() {
  const response = await worldsRequest(
    `/worlds/${worldIds[0]}/export?format=application/json`,
  );
  assert(
    response.body.quads.some(
      (quad) => quad.subject === `urn:wazoo:health:${runId}:alpha`,
    ),
    "Quad export missing alpha subject",
  );
  return response;
}

async function sparqlSelect() {
  const response = await worldsRequest(`/worlds/${worldIds[0]}/sparql`, {
    method: "POST",
    body: {
      query: `SELECT ?name WHERE { <urn:wazoo:health:${runId}:alpha> <http://schema.org/name> ?name } LIMIT 5`,
    },
  });
  assert(
    response.body.results.bindings.some(
      (binding) => binding.name?.value === `Alpha ${runId}`,
    ),
    "SPARQL SELECT missing expected binding",
  );
  return response;
}

async function sparqlAsk() {
  const response = await worldsRequest(`/worlds/${worldIds[0]}/sparql`, {
    method: "POST",
    body: {
      query: `ASK WHERE { <urn:wazoo:health:${runId}:alpha> <http://schema.org/knows> <urn:wazoo:health:${runId}:beta> }`,
    },
  });
  assert(response.body.boolean === true, "SPARQL ASK was not true");
  return response;
}

async function revokeWorldToken() {
  if (!state.worldTokenUid) throw new Error("Missing world token uid");
  return apiRequest(
    `/v1/worlds/${worldIds[0]}/auth/tokens/${state.worldTokenUid}?email=${encodeURIComponent(email)}`,
    { method: "DELETE" },
  );
}

async function deleteWorld(worldId) {
  return apiRequest(
    `/v1/worlds/${worldId}?email=${encodeURIComponent(email)}`,
    {
      method: "DELETE",
    },
  );
}

async function undeleteWorld(worldId) {
  return apiRequest(
    `/v1/worlds/${worldId}/undelete?email=${encodeURIComponent(email)}`,
    { method: "POST" },
  );
}

async function step(name, action) {
  process.stdout.write(`- ${name}... `);
  const response = await action();
  console.log(response?.status ?? "ok");
  return response;
}

async function apiRequest(path, options = {}) {
  return request(apiBaseUrl, path, {
    token: adminToken,
    ...options,
  });
}

async function worldsRequest(path, options = {}) {
  return request(worldsBaseUrl, path, {
    token: state.worldToken,
    ...options,
  });
}

async function request(baseUrl, path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.auth !== false) {
    if (!options.token) throw new Error(`Missing token for ${path}`);
    headers.set("authorization", `Bearer ${options.token}`);
  }
  if (options.body !== undefined)
    headers.set("content-type", "application/json");

  const response = await fetch(new URL(path.replace(/^\//, ""), baseUrl), {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const body = parseBody(text);
  const allowed = new Set(options.allowStatus ?? [200, 201, 204]);
  if (!allowed.has(response.status)) {
    throw new Error(
      `${options.method ?? "GET"} ${path} failed with ${response.status}: ${text}`,
    );
  }
  return { status: response.status, body };
}

function parseBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeBaseUrl(value) {
  const url = value.endsWith("/") ? value : `${value}/`;
  return url.endsWith("/v1/") ? url.slice(0, -3) : url;
}

function fail(message) {
  console.error(`\nPrivate beta health test failed: ${message}`);
  process.exit(1);
}
