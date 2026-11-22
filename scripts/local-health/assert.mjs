// Local health test assertions (wazoo-api#149). Behavior identical to the
// pre-split inline code.
export async function assertStatus(res, expected) {
  if (res.status !== expected) {
    const body = await res.text();
    throw new Error(
      `Expected ${expected}, got ${res.status}: ${body.slice(0, 200)}`,
    );
  }
}

export async function assertOk(res) {
  await assertStatus(res, 200);
}

export async function assertBadRequest(res) {
  await assertStatus(res, 400);
}

export async function assertUnauthorized(res) {
  await assertStatus(res, 401);
}

export async function assertNotFound(res) {
  await assertStatus(res, 404);
}

export function authHeaders(context) {
  return {
    Authorization: `Bearer ${context.ADMIN_TOKEN}`,
    "Content-Type": "application/json",
  };
}
