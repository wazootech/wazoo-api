/**
 * Shared plumbing for the negative smoke assertions: authenticated requests,
 * pass/fail results, and tracking plus cleanup of every throwaway token and
 * world. Only status codes and names are reported, never token values.
 */
export function createContext({
  apiUrl,
  worldsUrl,
  adminToken,
  ownerEmail,
  runId,
  fetchImpl = fetch,
}) {
  const tokenNames = [];
  const worldIds = [];
  const json = (r) => r.json().catch(() => null);
  const send = (url, method, token, body) =>
    fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const run = async (name, fn) => {
    try {
      const detail = await fn();
      const passed = detail === true;
      return { name, passed, detail: passed ? "refused as expected" : detail };
    } catch (err) {
      return { name, passed: false, detail: String(err) };
    }
  };
  const first = (...checks) => checks.find((c) => c !== true) ?? true;
  const expectStatus = (what, response, want) =>
    response.status === want ||
    `${what}: expected ${want}, got ${response.status}`;

  // Runs in the existing cleanup path, even after failures; 404 counts as gone.
  const cleanup = async () => {
    const failures = [];
    const del = async (url) => {
      try {
        const r = await send(url, "DELETE", adminToken);
        if (!r.ok && r.status !== 404) failures.push(`${r.status}`);
      } catch (err) {
        failures.push(String(err));
      }
    };
    for (const name of tokenNames)
      await del(`${apiUrl}/v1/auth/api-tokens/${name}`);
    const email = encodeURIComponent(ownerEmail);
    for (const id of worldIds)
      await del(`${apiUrl}/v1/worlds/${id}?email=${email}`);
    return {
      name: "cleanupNegativeFixtures",
      passed: failures.length === 0,
      detail: failures.length
        ? `delete failed: ${failures.join(",")}`
        : "throwaway tokens/worlds removed",
    };
  };

  return {
    apiUrl,
    worldsUrl,
    adminToken,
    ownerEmail,
    runId,
    tokenNames,
    worldIds,
    json,
    send,
    run,
    first,
    expectStatus,
    cleanup,
  };
}
