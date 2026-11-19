// In-process mock "server" behind the scripts' dry-run mode (wazoo-api#149):
// a route table matched against the incoming URL. Handlers return
// { status, json } or { status, text }; scripts/lib/http.mjs turns that into a
// real Response so script code keeps using res.json()/res.text()/res.ok.
import { parseJsonBody } from "../http.mjs";

function authorizationOf(headers) {
  if (!headers) return null;
  const value =
    typeof headers.get === "function"
      ? headers.get("authorization")
      : headers.Authorization ?? headers.authorization;
  if (typeof value !== "string") return null;
  const match = value.match(/^Bearer\s+(.+)$/);
  return match ? match[1].trim() : null;
}

export function createMockServer(routes, hosts) {
  // Base URLs may carry a trailing slash (normalizeBaseUrl); origins do not.
  const originOf = (value) => new URL(value).origin;
  const worldsOrigin = originOf(hosts.worlds);
  const consoleOrigin = hosts.console ? originOf(hosts.console) : null;
  return {
    handle: async (input, init = {}) => {
      const url = new URL(String(input));
      const method = (init.method ?? "GET").toUpperCase();
      const plane =
        url.origin === worldsOrigin
          ? "data"
          : consoleOrigin && url.origin === consoleOrigin
            ? "console"
            : "api";
      const request = {
        url,
        method,
        token: authorizationOf(init.headers),
        body: parseJsonBody(typeof init.body === "string" ? init.body : ""),
      };
      for (const route of routes) {
        if (route.method !== method) continue;
        if (route.plane !== plane) continue;
        const match = route.pattern.exec(url.pathname);
        if (!match) continue;
        return await route.handle(request, match);
      }
      return {
        status: 404,
        json: { error: `mock: no route for ${method} ${url.pathname}` },
      };
    },
  };
}
