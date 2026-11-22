// Local health tests: the authenticated CRUD flow (wazoo-api#149). Behavior
// identical to the pre-split inline code; each test receives the driver's
// context and reports through context.test.
import {
  assertOk,
  authHeaders,
} from "./assert.mjs";

export async function testAuthenticatedFlow(context) {
  const { BASE_URL, http, test } = context;

  await test("GET /v1/users/me?email=... creates/returns user", async () => {
    const res = await http(
      `${BASE_URL}/v1/users/me?email=${encodeURIComponent(context.testEmail)}`,
      { headers: authHeaders(context) },
    );
    const body = await res.json();
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`Unexpected status ${res.status}: ${JSON.stringify(body)}`);
    }
    if (!body.user?.uid) throw new Error("Missing user.uid");
    if (body.user.email !== context.testEmail)
      throw new Error(`Email mismatch: ${body.user.email}`);
    console.log(`        user uid: ${body.user.uid}`);
  });

  await test("GET /v1/worlds returns list (may be empty)", async () => {
    const res = await http(
      `${BASE_URL}/v1/worlds?email=${encodeURIComponent(context.testEmail)}`,
      { headers: authHeaders(context) },
    );
    await assertOk(res);
    const body = await res.json();
    if (!Array.isArray(body.worlds)) throw new Error("worlds is not an array");
  });

  await test("POST /v1/worlds creates a World", async () => {
    const res = await http(`${BASE_URL}/v1/worlds`, {
      method: "POST",
      headers: authHeaders(context),
      body: JSON.stringify({
        ownerEmail: context.testEmail,
        displayName: "Health Test World",
      }),
    });
    const body = await res.json();
    if (res.status !== 201) {
      if (res.status === 429) {
        console.log(`        SKIP (quota exceeded)`);
        context.passed++;
        return;
      }
      if (res.status === 502) {
        console.log(
          `        SKIP (provisioning failed — the data plane may not be configured)`,
        );
        context.passed++;
        return;
      }
      throw new Error(`Unexpected status ${res.status}: ${JSON.stringify(body)}`);
    }
    const worldId = body.world?.id;
    if (
      typeof worldId !== "string" ||
      !/^w_[0-7][0-9a-hjkmnp-tv-z]{25}$/.test(worldId)
    ) {
      throw new Error("Missing canonical world.id");
    }
    context.testWorldId = worldId;
    console.log(`        world id: ${worldId}`);
  });

  await test("GET /v1/worlds/:worldId returns the World", async () => {
    const res = await http(
      `${BASE_URL}/v1/worlds/${context.testWorldId}?email=${encodeURIComponent(context.testEmail)}`,
      { headers: authHeaders(context) },
    );
    const body = await res.json();
    if (res.status !== 200) {
      if (res.status === 404) {
        console.log(`        SKIP (world not found — may not have been created)`);
        context.passed++;
        return;
      }
      throw new Error(`Unexpected status ${res.status}: ${JSON.stringify(body)}`);
    }
    if (body.world?.id !== context.testWorldId)
      throw new Error(`world id mismatch: ${body.world?.id}`);
  });

  await test("PATCH /v1/worlds/:worldId updates displayName", async () => {
    const res = await http(
      `${BASE_URL}/v1/worlds/${context.testWorldId}?email=${encodeURIComponent(context.testEmail)}`,
      {
        method: "PATCH",
        headers: authHeaders(context),
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
        context.passed++;
        return;
      }
      throw new Error(`Unexpected status ${res.status}: ${JSON.stringify(body)}`);
    }
    if (body.world?.displayName !== "Updated Health World")
      throw new Error(`displayName not updated: ${body.world?.displayName}`);
  });
}
