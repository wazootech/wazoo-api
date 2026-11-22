// Canary checks (wazoo-api#149): reachability, readiness, OpenAPI documents,
// and the unauthenticated auth boundary of each deployed service. Behavior
// identical to the pre-split inline code; each check returns a problem string
// or null.
async function json(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function canaryChecks(context) {
  const { API, WORLDS, CONSOLE, get } = context;
  return [
  ["api /health", async () => {
    const r = await get(`${API}/health`);
    const b = await json(r);
    return r.status === 200 && b?.status === "ok"
      ? null
      : `status ${r.status}, body.status ${String(b?.status)}`;
  }],
  ["api /ready", async () => {
    const r = await get(`${API}/ready`);
    const b = await json(r);
    return r.status === 200 && b?.status === "ready"
      ? null
      : `status ${r.status}, body.status ${String(b?.status)}`;
  }],
  ["api /openapi.json", async () => {
    const r = await get(`${API}/openapi.json`);
    const b = await json(r);
    return r.status === 200 && b?.openapi !== undefined && b?.paths !== undefined
      ? null
      : `status ${r.status}, not an OpenAPI document`;
  }],
  ["api rejects unauthenticated /v1/worlds", async () => {
    const r = await get(`${API}/v1/worlds`);
    return r.status === 401 ? null : `expected 401, got ${r.status}`;
  }],
  ["worlds /health", async () => {
    const r = await get(`${WORLDS}/health`);
    const b = await json(r);
    return r.status === 200 && b?.status === "ok"
      ? null
      : `status ${r.status}, body.status ${String(b?.status)}`;
  }],
  ["worlds /ready", async () => {
    const r = await get(`${WORLDS}/ready`);
    const b = await json(r);
    return r.status === 200 && b?.status === "ready"
      ? null
      : `status ${r.status}, body.status ${String(b?.status)}`;
  }],
  ["worlds /openapi.json", async () => {
    const r = await get(`${WORLDS}/openapi.json`);
    const b = await json(r);
    return r.status === 200 && b?.openapi !== undefined && b?.paths !== undefined
      ? null
      : `status ${r.status}, not an OpenAPI document`;
  }],
  ["worlds rejects unauthenticated /worlds", async () => {
    const r = await get(`${WORLDS}/worlds`);
    return r.status === 401 ? null : `expected 401, got ${r.status}`;
  }],
  ["console /api/health", async () => {
    const r = await get(`${CONSOLE}/api/health`);
    const b = await json(r);
    return r.status === 200 && b?.status === "ok"
      ? null
      : `status ${r.status}, body.status ${String(b?.status)}`;
  }],
  ["console redirects unauthenticated /worlds", async () => {
    const r = await get(`${CONSOLE}/worlds`, { redirect: "manual" });
    return r.status >= 300 && r.status < 400
      ? null
      : `expected 3xx, got ${r.status}`;
  }],
  ];
}
