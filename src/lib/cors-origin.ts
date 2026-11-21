// Console PR previews (wazoo-console wrangler.preview.jsonc) are served at
// <preview-name>.preview.console.wazoo.dev, one hostname per branch or version.
const PREVIEW_HOST = /^https?:\/\/([^/]*\.)?preview\.console\.wazoo\.dev$/;
const CONSOLE_PREVIEW_ORIGIN =
  /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?\.preview\.console\.wazoo\.dev$/;

/**
 * The Access-Control-Allow-Origin value for a request origin, or null to deny.
 * Console preview origins are allowed only on QA, since previews talk to
 * api-qa and must never reach prod. Every host under preview.console.wazoo.dev
 * is classified as a preview (any scheme, any depth) before the blanket
 * `.wazoo.dev` rule, which would otherwise trust them in every environment.
 */
export function corsOrigin(
  origin: string | undefined,
  wazooEnv: string | undefined,
): string | null {
  if (!origin) return null;
  if (PREVIEW_HOST.test(origin)) {
    return wazooEnv === "qa" && CONSOLE_PREVIEW_ORIGIN.test(origin)
      ? origin
      : null;
  }
  if (origin.endsWith(".wazoo.dev")) return origin;
  if (origin.startsWith("http://localhost:")) return origin;
  return null;
}
