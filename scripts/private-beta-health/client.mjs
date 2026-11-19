// Shared request plumbing for the private-beta health steps (wazoo-api#149).
// Behavior identical to the pre-split inline code.
export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function apiRequest(context) {
  return async (path, options = {}) =>
    request(context, context.apiBaseUrl, path, {
      token: context.adminToken,
      ...options,
    });
}

export function worldsRequest(context) {
  return async (path, options = {}) =>
    request(context, context.worldsBaseUrl, path, {
      token: context.state.worldToken,
      ...options,
    });
}

export async function request(context, baseUrl, path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.auth !== false) {
    if (!options.token) throw new Error(`Missing token for ${path}`);
    headers.set("authorization", `Bearer ${options.token}`);
  }
  if (options.body !== undefined)
    headers.set("content-type", "application/json");

  const response = await context.http(new URL(path.replace(/^\//, ""), baseUrl), {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const body = parseBody(text);
  const allowed = new Set(options.allowStatus ?? [200, 201, 204]);
  if (!allowed.has(response.status)) {
    throw new Error(
      `${options.method ?? "GET"} ${path} failed with ${response.status}: ${text}`,
    );
  }
  return { status: response.status, body };
}
