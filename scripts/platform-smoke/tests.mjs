// Platform smoke gate: reachability-level tests (redirect, health, OpenAPI,
// unauthenticated 401s) (wazoo-api#149). Behavior identical to the pre-split
// inline code.
import { check, jsonOrNull } from "./helpers.mjs";

export async function testUnauthenticatedAppRedirect(context) {
  const { CONSOLE_URL, http } = context;
  return check("testUnauthenticatedAppRedirect", async () => {
    const response = await http(`${CONSOLE_URL}/worlds`, {
      redirect: "manual",
    });
    const passed = response.status >= 300 && response.status < 400;
    return {
      name: "testUnauthenticatedAppRedirect",
      passed,
      detail: passed
        ? `unauthenticated /worlds redirects (${response.status})`
        : `expected 3xx redirect from /worlds, got ${response.status}`,
    };
  });
}

export async function testApiHealth(context) {
  const { API_BASE_URL, WORLDS_API_URL, CONSOLE_URL, http } = context;
  return check("testApiHealth", async () => {
    const urls = [
      `${API_BASE_URL}/health`,
      `${WORLDS_API_URL}/health`,
      ...(CONSOLE_URL ? [`${CONSOLE_URL}/api/health`] : []),
    ];
    for (const url of urls) {
      const response = await http(url);
      if (response.status !== 200) {
        return {
          name: "testApiHealth",
          passed: false,
          detail: `expected 200 from ${url}, got ${response.status}`,
        };
      }
      const body = await jsonOrNull(response);
      if (body?.status !== "ok") {
        return {
          name: "testApiHealth",
          passed: false,
          detail: `expected status ok from ${url}, got ${String(body?.status)}`,
        };
      }
    }
    return { name: "testApiHealth", passed: true, detail: "health endpoints report ok" };
  });
}

export async function testOpenApiReachable(context) {
  const { API_BASE_URL, WORLDS_API_URL, http } = context;
  return check("testOpenApiReachable", async () => {
    const urls = [
      `${API_BASE_URL}/openapi.json`,
      `${WORLDS_API_URL}/openapi.json`,
    ];
    for (const url of urls) {
      const response = await http(url);
      if (response.status !== 200) {
        return {
          name: "testOpenApiReachable",
          passed: false,
          detail: `expected 200 from ${url}, got ${response.status}`,
        };
      }
      const body = await jsonOrNull(response);
      if (body?.openapi === undefined || body?.paths === undefined) {
        return {
          name: "testOpenApiReachable",
          passed: false,
          detail: `openapi.json from ${url} missing openapi/paths`,
        };
      }
    }
    return { name: "testOpenApiReachable", passed: true, detail: "OpenAPI specs reachable" };
  });
}

export async function testUnauthenticatedApiCallsReturn401(context) {
  const { API_BASE_URL, WORLDS_API_URL, http } = context;
  return check("testUnauthenticatedApiCallsReturn401", async () => {
    const apiResponse = await http(`${API_BASE_URL}/v1/worlds`);
    if (apiResponse.status !== 401) {
      return {
        name: "testUnauthenticatedApiCallsReturn401",
        passed: false,
        detail: `expected 401 from ${API_BASE_URL}/v1/worlds, got ${apiResponse.status}`,
      };
    }
    const worldsResponse = await http(`${WORLDS_API_URL}/worlds`);
    if (worldsResponse.status !== 401) {
      return {
        name: "testUnauthenticatedApiCallsReturn401",
        passed: false,
        detail: `expected 401 from ${WORLDS_API_URL}/worlds, got ${worldsResponse.status}`,
      };
    }
    return {
      name: "testUnauthenticatedApiCallsReturn401",
      passed: true,
      detail: "unauthenticated API calls return 401",
    };
  });
}
