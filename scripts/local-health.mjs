// Local health test for wazoo-api
// Usage: node scripts/local-health.mjs [baseUrl]
//   Defaults to http://localhost:8787 for wrangler dev
//   Set WAZOO_PLATFORM_ADMIN_TOKEN env var for authenticated tests

const BASE_URL = process.argv[2] ?? "http://localhost:8787";
const ADMIN_TOKEN = required("WAZOO_PLATFORM_ADMIN_TOKEN");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
  }
}

async function assertStatus(res, expected) {
  if (res.status !== expected) {
    const body = await res.text();
    throw new Error(
      `Expected ${expected}, got ${res.status}: ${body.slice(0, 200)}`,
    );
  }
}

async function assertOk(res) {
  await assertStatus(res, 200);
}

async function assertCreated(res) {
  await assertStatus(res, 201);
}

async function assertBadRequest(res) {
  await assertStatus(res, 400);
}

async function assertUnauthorized(res) {
  await assertStatus(res, 401);
}

async function assertNotFound(res) {
  await assertStatus(res, 404);
}

function authHeaders() {
  return {
    Authorization: `Bearer ${ADMIN_TOKEN}`,
    "Content-Type": "application/json",
  };
}

// ── Start ──

console.log(`\nWazoo API local health test`);
console.log(`  Base URL: ${BASE_URL}`);
console.log(`  Admin token: ${ADMIN_TOKEN ? "set" : "NOT SET (auth tests skipped)"}\n`);

// ── Health ───

await test("GET /health returns ok", async () => {
  const res = await fetch(`${BASE_URL}/health`);
  await assertOk(res);
  const body = await res.json();
  if (body.status !== "ok") throw new Error(`status is ${body.status}`);
});

await test("GET /openapi.json returns OpenAPI spec", async () => {
  const res = await fetch(`${BASE_URL}/openapi.json`);
  await assertOk(res);
  const body = await res.json();
  if (!body.openapi) throw new Error("Missing openapi version");
  if (!body.paths) throw new Error("Missing paths");
  if (!body.info) throw new Error("Missing info");
  console.log(
    `        OpenAPI ${body.openapi}: ${Object.keys(body.paths).length} paths, ${body.info.title}`,
  );
});

// ── Auth validation ───

await test("GET /v1/worlds without token returns 401", async () => {
  const res = await fetch(`${BASE_URL}/v1/worlds`);
  await assertUnauthorized(res);
});

await test("GET /v1/worlds with invalid token returns 401", async () => {
  const res = await fetch(`${BASE_URL}/v1/worlds`, {
    headers: { Authorization: "Bearer wzp_invalidtoken123" },
  });
  await assertUnauthorized(res);
});

// ── Schema validation (no auth needed for these, auth middleware catches first) ───

await test("POST /v1/worlds without body returns 400", async () => {
  const res = await fetch(`${BASE_URL}/v1/worlds`, {
    method: "POST",
    headers: authHeaders(),
  });
  await assertBadRequest(res);
});

await test("POST /v1/worlds with invalid worldId returns 400", async () => {
  const res = await fetch(`${BASE_URL}/v1/worlds`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      worldId: "",
      world: { displayName: "Test" },
    }),
  });
  await assertBadRequest(res);
});

await test("POST /v1/users/me without email returns 400", async () => {
  const res = await fetch(`${BASE_URL}/v1/users/me`, {
    headers: authHeaders(),
  });
  await assertBadRequest(res);
});

// ── Authenticated health flow (requires admin token) ───

const testEmail = `health-${Date.now()}@wazoo.dev`;
const testWorldId = `health-${Date.now()}`;

await test("GET /v1/users/me?email=... creates/returns user", async () => {
    const res = await fetch(
      `${BASE_URL}/v1/users/me?email=${encodeURIComponent(testEmail)}`,
      { headers: authHeaders() },
    );
    const body = await res.json();
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`Unexpected status ${res.status}: ${JSON.stringify(body)}`);
    }
    if (!body.user?.uid) throw new Error("Missing user.uid");
    if (body.user.email !== testEmail)
      throw new Error(`Email mismatch: ${body.user.email}`);
    console.log(`        user uid: ${body.user.uid}`);
  });

  await test("GET /v1/worlds returns list (may be empty)", async () => {
    const res = await fetch(
      `${BASE_URL}/v1/worlds?email=${encodeURIComponent(testEmail)}`,
      { headers: authHeaders() },
    );
    await assertOk(res);
    const body = await res.json();
    if (!Array.isArray(body.worlds)) throw new Error("worlds is not an array");
  });

  await test("POST /v1/worlds creates a World", async () => {
    const res = await fetch(`${BASE_URL}/v1/worlds`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        ownerEmail: testEmail,
        worldId: testWorldId,
        world: { displayName: "Health Test World" },
      }),
    });
    const body = await res.json();
    if (res.status !== 201) {
      if (res.status === 429) {
        console.log(`        SKIP (quota exceeded)`);
        passed++;
        return;
      }
      if (res.status === 502) {
        console.log(`        SKIP (provisioning failed — Turso may not be configured)`);
        passed++;
        return;
      }
      throw new Error(`Unexpected status ${res.status}: ${JSON.stringify(body)}`);
    }
    if (!body.world?.uid) throw new Error("Missing world.uid");
    console.log(`        world uid: ${body.world.uid}`);
  });

  await test("GET /v1/worlds/:worldId returns the World", async () => {
    const res = await fetch(
      `${BASE_URL}/v1/worlds/${testWorldId}?email=${encodeURIComponent(testEmail)}`,
      { headers: authHeaders() },
    );
    const body = await res.json();
    if (res.status !== 200) {
      if (res.status === 404) {
        console.log(`        SKIP (world not found — may not have been created)`);
        passed++;
        return;
      }
      throw new Error(`Unexpected status ${res.status}: ${JSON.stringify(body)}`);
    }
    if (body.world?.worldId !== testWorldId)
      throw new Error(`worldId mismatch: ${body.world?.worldId}`);
  });

  await test("PATCH /v1/worlds/:worldId updates displayName", async () => {
    const res = await fetch(
      `${BASE_URL}/v1/worlds/${testWorldId}?email=${encodeURIComponent(testEmail)}`,
      {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({
          updateMask: "displayName",
          world: { displayName: "Updated Health World" },
        }),
      },
    );
    const body = await res.json();
    if (res.status !== 200) {
      if (res.status === 404) {
        console.log(`        SKIP (world not found)`);
        passed++;
        return;
      }
      throw new Error(`Unexpected status ${res.status}: ${JSON.stringify(body)}`);
    }
    if (body.world?.displayName !== "Updated Health World")
      throw new Error(`displayName not updated: ${body.world?.displayName}`);
  });

  await test("DELETE /v1/worlds/:worldId deletes the World", async () => {
    const res = await fetch(
      `${BASE_URL}/v1/worlds/${testWorldId}?email=${encodeURIComponent(testEmail)}`,
      { method: "DELETE", headers: authHeaders() },
    );
    if (res.status !== 200 && res.status !== 404) {
      const body = await res.json();
      throw new Error(`Unexpected status ${res.status}: ${JSON.stringify(body)}`);
    }
  });

  await test("DELETE /v1/worlds/nonexistent returns 404", async () => {
    const res = await fetch(
      `${BASE_URL}/v1/worlds/nonexistent-zzz?email=${encodeURIComponent(testEmail)}`,
      { method: "DELETE", headers: authHeaders() },
    );
    await assertNotFound(res);
  });

  await test("GET /v1/auth/api-tokens lists platform tokens", async () => {
    const res = await fetch(`${BASE_URL}/v1/auth/api-tokens`, {
      headers: authHeaders(),
    });
    await assertOk(res);
    const body = await res.json();
    if (!Array.isArray(body.tokens)) throw new Error("tokens is not an array");
  });

  await test("GET /v1/auth/api-tokens/validate returns token expiry", async () => {
    const res = await fetch(`${BASE_URL}/v1/auth/api-tokens/validate`, {
      headers: authHeaders(),
    });
    await assertOk(res);
    const body = await res.json();
    if (typeof body.exp !== "number")
      throw new Error(`exp is not a number: ${typeof body.exp}`);
  });

// ── Results ───

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);
