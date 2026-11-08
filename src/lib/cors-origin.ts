// Console PR previews (wazoo-console wrangler.preview.jsonc) run on
// workers.dev: the base URL, plus a `<branch-or-version>-` prefix per preview.
const CONSOLE_PREVIEW_ORIGIN =
  /^https:\/\/([a-z0-9-]+-)?wazoo-console-preview\.ethan-r-davidson\.workers\.dev$/;

/**
 * The Access-Control-Allow-Origin value for a request origin, or null to deny.
 * Console preview origins are allowed only on QA, since previews talk to
 * api-qa and must never reach prod.
 */
export function corsOrigin(
  origin: string | undefined,
  wazooEnv: string | undefined,
): string | null {
  if (!origin) return null;
  if (origin.endsWith(".wazoo.dev")) return origin;
  if (origin.startsWith("http://localhost:")) return origin;
  if (wazooEnv === "qa" && CONSOLE_PREVIEW_ORIGIN.test(origin)) return origin;
  return null;
}
