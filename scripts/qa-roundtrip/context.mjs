// Shared context for the QA round trip scenario modules (wazoo-api#149):
// evidence recording, the call() helper, the cleanup stack, and the per-run
// state (tokens, world ids) every step shares.
import { Evidence } from "../lib/evidence.mjs";
import { mockAwareFetch } from "../lib/http.mjs";
import { createPlatformMock } from "../lib/mock/index.mjs";
import { runStamp } from "../lib/mode.mjs";
import { WORLD_ID_RE } from "../lib/world-id.mjs";

export { WORLD_ID_RE };

export function createContext(config) {
  const run = runStamp("rt");
  const http = mockAwareFetch(
    createPlatformMock({ api: config.API, worlds: config.DATA }),
  );
  const context = {
    config,
    run,
    emailA: `e2e+${run}-a@wazoo.dev`,
    emailB: `e2e+${run}-b@wazoo.dev`,
    MARKER: `zephyrquokka${run}`,
    evidence: new Evidence(run),
    cleanup: [],
    state: {
      tokenA: null,
      tokenB: null,
      worldId: null,
      worldToken: null,
      bWorldId: null,
      bWorldToken: null,
      hybridReady: false,
    },
  };
  for (const secret of [config.ADMIN, config.DATA_ADMIN, config.PROVIDER_KEY])
    if (secret) context.evidence.secrets.add(secret);
  context.record = (...args) => context.evidence.record(...args);
  context.call = async (method, url, token, body) => {
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await http(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, json, text };
  };
  return context;
}
