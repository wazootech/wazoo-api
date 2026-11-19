// Local health tests: health, OpenAPI, auth validation and schema validation
// (wazoo-api#149). Behavior identical to the pre-split inline code; each test
// receives the driver's context and reports through context.test.
import { assertOk, assertBadRequest, assertUnauthorized, authHeaders } from "./assert.mjs";

export async function testHealth(context) {
  await context.test("GET /health returns ok", async () => {
    const res = await context.http(`${context.BASE_URL}/health`);
    await assertOk(res);
    const body = await res.json();
    if (body.status !== "ok") throw new Error(`status is ${body.status}`);
  });
}

export async function testOpenApi(context) {
  await context.test("GET /openapi.json returns OpenAPI spec", async () => {
    const res = await context.http(`${context.BASE_URL}/openapi.json`);
    await assertOk(res);
    const body = await res.json();
    if (!body.openapi) throw new Error("Missing openapi version");
    if (!body.paths) throw new Error("Missing paths");
    if (!body.info) throw new Error("Missing info");
    console.log(
      `        OpenAPI ${body.openapi}: ${Object.keys(body.paths).length} paths, ${body.info.title}`,
    );
  });
}

// ── Auth validation ───

export async function testAuthValidation(context) {
  await context.test("GET /v1/worlds without token returns 401", async () => {
    const res = await context.http(`${context.BASE_URL}/v1/worlds`);
    await assertUnauthorized(res);
  });

  await context.test("GET /v1/worlds with invalid token returns 401", async () => {
    const res = await context.http(`${context.BASE_URL}/v1/worlds`, {
      headers: { Authorization: "Bearer wzp_invalidtoken123" },
    });
    await assertUnauthorized(res);
  });
}

// ── Schema validation (no auth needed for these, auth middleware catches first) ───

export async function testSchemaValidation(context) {
  await context.test("POST /v1/worlds without body returns 400", async () => {
    const res = await context.http(`${context.BASE_URL}/v1/worlds`, {
      method: "POST",
      headers: authHeaders(context),
    });
    await assertBadRequest(res);
  });

  await context.test("POST /v1/worlds rejects a client-supplied worldId", async () => {
    const res = await context.http(`${context.BASE_URL}/v1/worlds`, {
      method: "POST",
      headers: authHeaders(context),
      body: JSON.stringify({
        worldId: "",
        displayName: "Test",
      }),
    });
    await assertBadRequest(res);
  });

  await context.test("POST /v1/users/me without email returns 400", async () => {
    const res = await context.http(`${context.BASE_URL}/v1/users/me`, {
      headers: authHeaders(context),
    });
    await assertBadRequest(res);
  });
}
