/** Data-plane (worlds-api) negative assertions. */

// Obviously internal/invalid: the engine must refuse before any fetch happens.
export const LOAD_TARGET = "http://169.254.169.254/x";
const LOAD_GRAPH = "urn:smoke:load";

export function dataPlaneChecks(ctx) {
  const { worldsUrl, runId, json, send, run, first, expectStatus } = ctx;

  // worlds-api#182: a world-bound key may not use namespace-level routes.
  const testWorldKeyNamespaceRoutes = (worldToken) =>
    run("testWorldKeyNamespaceRoutes", async () => {
      if (!worldToken) return "no world token on context";
      const post = await send(`${worldsUrl}/worlds`, "POST", worldToken, {
        displayName: `E2E Forbidden ${runId}`,
      });
      if (post.status === 201) {
        const body = await json(post);
        const leaked = body?.world?.id ?? body?.id;
        if (leaked) ctx.worldIds.push(leaked);
      }
      const list = await send(`${worldsUrl}/worlds`, "GET", worldToken);
      return first(
        expectStatus("POST /worlds", post, 403),
        expectStatus("GET /worlds", list, 403),
      );
    });

  // sparql-engine#259 / worlds-cloudflare#75 / worlds-api#187: remote LOAD denied.
  const testRemoteLoadDenied = (worldToken, worldId) =>
    run("testRemoteLoadDenied", async () => {
      if (!worldToken || !worldId) return "no world token/id on context";
      const sparql = (query) =>
        send(`${worldsUrl}/worlds/${worldId}/sparql`, "POST", worldToken, {
          query,
        });
      const load = await sparql(
        `LOAD <${LOAD_TARGET}> INTO GRAPH <${LOAD_GRAPH}>`,
      );
      if (load.status >= 200 && load.status < 300)
        return `LOAD: expected refusal, got ${load.status}`;
      const text = await load.text().catch(() => "");
      if (!/policy|not permitted/i.test(text))
        return `LOAD: ${load.status} without a policy error`;
      const ask = await sparql(`ASK { GRAPH <${LOAD_GRAPH}> { ?s ?p ?o } }`);
      if (ask.status !== 200)
        return `post-LOAD ask: expected 200, got ${ask.status}`;
      return (
        (await json(ask))?.boolean === false ||
        "LOAD: graph is not empty after refusal"
      );
    });

  return { testWorldKeyNamespaceRoutes, testRemoteLoadDenied };
}
