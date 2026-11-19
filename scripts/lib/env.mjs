// Shared env loading and target validation for the operational scripts
// (wazoo-api#149). Each script's CLI behavior, including error wording, is
// unchanged; the helpers only remove duplicated local definitions.

export function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// private-beta-health's normalization: ensure a trailing slash, then drop a
// trailing /v1 segment so paths join uniformly against the base URL.
export function normalizeBaseUrl(value) {
  const url = value.endsWith("/") ? value : `${value}/`;
  return url.endsWith("/v1/") ? url.slice(0, -3) : url;
}

export function isLocalHttp(url) {
  return (
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  );
}

// platform-smoke's rule: HTTPS to the named host, or local HTTP.
// options.message overrides the thrown wording (local-health reuses the rule).
export function assertTarget(name, value, allowedHostname, options = {}) {
  const url = new URL(value);
  const ok =
    isLocalHttp(url) ||
    (url.protocol === "https:" && url.hostname === allowedHostname);
  if (!ok) {
    throw new Error(
      options.message ??
        `Smoke target ${name} must be over HTTPS to ${allowedHostname} or local HTTP, got ${value}`,
    );
  }
  return url.origin;
}

// platform-canary's stricter rule: HTTPS to exactly the expected host, no
// local override.
export function assertCanaryTarget(name, value, hostname) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== hostname) {
    throw new Error(`${name} must be https://${hostname}, got ${value}`);
  }
  return url.origin;
}
