// Console PR previews (wazoo-console wrangler.preview.jsonc) are served at
// <preview-name>.preview.console.wazoo.dev, one hostname per branch or version.
// They call the API preview Worker (WAZOO_ENV "preview", wrangler.preview.toml).
const PREVIEW_HOST = /^https?:\/\/([^/]*\.)?preview\.console\.wazoo\.dev$/;
const CONSOLE_PREVIEW_ORIGIN =
  /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?\.preview\.console\.wazoo\.dev$/;
// Environments that trust console preview origins. "qa" is transitional: drop
// it when the api-qa / console-qa hosts are retired.
const PREVIEW_ENVS: ReadonlySet<string> = new Set(["preview", "qa"]);
// One or more non-empty DNS labels, then wazoo.dev (rejects "https://.wazoo.dev").
const WAZOO_SUBDOMAIN = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+wazoo\.dev$/;

/**
 * Parses a bare origin. Returns null unless the string round-trips through
 * `URL.origin`, which rejects userinfo, paths, queries, trailing characters,
 * and non-canonical case or default ports.
 */
function parseOrigin(origin: string): URL | null {
  try {
    const url = new URL(origin);
    return url.origin === origin ? url : null;
  } catch {
    return null;
  }
}

// TODO(https://github.com/wazootech/wazoo-api/issues/178): this blanket rule
// still trusts every https subdomain of wazoo.dev. Replace it with an explicit
// allowlist (console.wazoo.dev, console-qa.wazoo.dev); see the audit in #178.
function isWazooSubdomain(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    url.port === "" &&
    WAZOO_SUBDOMAIN.test(url.hostname)
  );
}

function isLocalhost(url: URL): boolean {
  return (
    url.protocol === "http:" && url.hostname === "localhost" && url.port !== ""
  );
}

/**
 * The Access-Control-Allow-Origin value for a request origin, or null to deny.
 * Console preview origins are allowed only where WAZOO_ENV is "preview" (the
 * API preview Worker) or "qa" (kept until the -qa hosts are removed, since
 * console previews still call api-qa); they must never reach prod. Every host under preview.console.wazoo.dev
 * is classified as a preview (any scheme, any depth) before the blanket
 * `.wazoo.dev` rule, which would otherwise trust them in every environment.
 * The blanket rule requires https and a bare origin (no userinfo, port, path).
 */
export function corsOrigin(
  origin: string | undefined,
  wazooEnv: string | undefined,
): string | null {
  if (!origin) return null;
  if (PREVIEW_HOST.test(origin)) {
    return PREVIEW_ENVS.has(wazooEnv ?? "") &&
      CONSOLE_PREVIEW_ORIGIN.test(origin)
      ? origin
      : null;
  }
  const url = parseOrigin(origin);
  if (url && (isWazooSubdomain(url) || isLocalhost(url))) return origin;
  return null;
}
