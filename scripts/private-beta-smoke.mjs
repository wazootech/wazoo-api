#!/usr/bin/env node

const baseUrl = normalizeBaseUrl(process.env.API_BASE_URL ?? "http://localhost:8787");
const token = process.env.WAZOO_ADMIN_TOKEN ?? process.env.WAZOO_PLATFORM_TOKEN;
const organizationId = process.env.WAZOO_SMOKE_ORG ?? "beta-smoke";
const worldId = process.env.WAZOO_SMOKE_WORLD ?? `smoke-${Date.now().toString(36)}`;

if (!token) {
  fail("Set WAZOO_ADMIN_TOKEN to a global admin platform token before running the smoke test.");
}

const state = { organizationId, worldId, worldTokenUid: null };

try {
  await step("health", () => request("/health", { auth: false }));
  await step("ensure organization", ensureOrganization);
  await step("create world", createWorld);
  await step("sync world", () => request(`/v1/organizations/${organizationId}/worlds/${worldId}/sync`, { method: "POST" }));
  await step("create world token", createWorldToken);
  await step("rotate world token", rotateWorldToken);
  await step("revoke replacement token", revokeWorldToken);
  await step("read usage", () => request(`/v1/organizations/${organizationId}/worlds/${worldId}/usage`));
  await step("read limits", () => request(`/v1/organizations/${organizationId}/limits`));
  await step("read billing", () => request(`/v1/organizations/${organizationId}/billing`));
  await step("soft-delete world", () => request(`/v1/organizations/${organizationId}/worlds/${worldId}`, { method: "DELETE" }));
  await step("undelete world", () => request(`/v1/organizations/${organizationId}/worlds/${worldId}/undelete`, { method: "POST" }));
  await step("final soft-delete world", () => request(`/v1/organizations/${organizationId}/worlds/${worldId}`, { method: "DELETE" }));
  console.log(`\nPrivate beta smoke test passed for organizations/${organizationId}/worlds/${worldId}`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

async function ensureOrganization() {
  const existing = await request(`/v1/organizations/${organizationId}`, { allowStatus: [200, 404] });
  if (existing.status === 200) return existing.body;
  return request("/v1/organizations", {
    method: "POST",
    body: {
      organizationId,
      organization: { displayName: "Beta Smoke" },
    },
  });
}

async function createWorld() {
  return request(`/v1/organizations/${organizationId}/worlds`, {
    method: "POST",
    body: {
      worldId,
      world: { displayName: "Private Beta Smoke World" },
    },
  });
}

async function createWorldToken() {
  const response = await request(`/v1/organizations/${organizationId}/worlds/${worldId}/auth/tokens`, {
    method: "POST",
    body: { name: "smoke" },
  });
  state.worldTokenUid = response.body.uid;
  return response;
}

async function rotateWorldToken() {
  const response = await request(`/v1/organizations/${organizationId}/worlds/${worldId}/auth/rotate`, {
    method: "POST",
    body: { name: "smoke-rotated" },
  });
  state.worldTokenUid = response.body.uid;
  return response;
}

async function revokeWorldToken() {
  if (!state.worldTokenUid) throw new Error("Missing rotated world token uid");
  return request(`/v1/organizations/${organizationId}/worlds/${worldId}/auth/tokens/${state.worldTokenUid}`, { method: "DELETE" });
}

async function step(name, action) {
  process.stdout.write(`- ${name}... `);
  const response = await action();
  console.log(response?.status ?? "ok");
  return response;
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.auth !== false) headers.set("authorization", `Bearer ${token}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");

  const response = await fetch(new URL(path.replace(/^\//, ""), baseUrl), {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  const allowed = new Set(options.allowStatus ?? [200, 201, 204]);
  if (!allowed.has(response.status)) {
    throw new Error(`${options.method ?? "GET"} ${path} failed with ${response.status}: ${text}`);
  }
  return { status: response.status, body };
}

function normalizeBaseUrl(value) {
  const url = value.endsWith("/") ? value : `${value}/`;
  return url.endsWith("/v1/") ? url.slice(0, -3) : url;
}

function fail(message) {
  console.error(`\nPrivate beta smoke test failed: ${message}`);
  process.exit(1);
}
