import { assertNotFound, assertOk, authHeaders } from "./assert.mjs";

export async function testWorldDeleteAndTokens(context) {
  const { BASE_URL, http, test } = context;

  await test("DELETE /v1/worlds/:worldId deletes the World", async () => {
    const res = await http(
      `${BASE_URL}/v1/worlds/${context.testWorldId}?email=${encodeURIComponent(context.testEmail)}`,
      { method: "DELETE", headers: authHeaders(context) },
    );
    if (res.status !== 200 && res.status !== 404) {
      const body = await res.json();
      throw new Error(`Unexpected status ${res.status}: ${JSON.stringify(body)}`);
    }
  });

  await test("DELETE /v1/worlds/:worldId returns 404 for an unknown canonical ID", async () => {
    const res = await http(
      `${BASE_URL}/v1/worlds/${context.randomWorldId()}?email=${encodeURIComponent(context.testEmail)}`,
      { method: "DELETE", headers: authHeaders(context) },
    );
    await assertNotFound(res);
  });

  await test("GET /v1/auth/api-tokens lists platform tokens", async () => {
    const res = await http(`${BASE_URL}/v1/auth/api-tokens`, {
      headers: authHeaders(context),
    });
    await assertOk(res);
    const body = await res.json();
    if (!Array.isArray(body.tokens)) throw new Error("tokens is not an array");
  });

  await test("GET /v1/auth/api-tokens/validate returns token expiry", async () => {
    const res = await http(`${BASE_URL}/v1/auth/api-tokens/validate`, {
      headers: authHeaders(context),
    });
    await assertOk(res);
    const body = await res.json();
    if (typeof body.exp !== "number")
      throw new Error(`exp is not a number: ${typeof body.exp}`);
  });
}
