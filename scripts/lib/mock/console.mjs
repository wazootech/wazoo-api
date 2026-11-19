// Console routes for the script mock server (wazoo-api#149): reachability and
// the unauthenticated redirect the smoke gate and canary assert on.

export function consoleRoutes() {
  return [
    {
      method: "GET",
      plane: "console",
      pattern: /^\/api\/health$/,
      handle: () => ({ status: 200, json: { status: "ok" } }),
    },
    {
      method: "GET",
      plane: "console",
      pattern: /^\/worlds$/,
      handle: () => ({ status: 302, text: "redirect" }),
    },
  ];
}
