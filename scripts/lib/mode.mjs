// Shared dry-run/mock mode for the operational scripts (wazoo-api#149).
//
// WAZOO_SCRIPT_MODE=mock or a `--dry-run` argument routes every request to the
// in-process mock server (scripts/lib/mock/) and pins timestamps, run ids and
// random ids, so each script's full flow runs in CI with no network, no
// credentials and byte-stable output. That is also how a split was verified:
// the pre-split and post-split script must produce identical mock-mode output.
export const MOCK =
  process.env.WAZOO_SCRIPT_MODE === "mock" || process.argv.includes("--dry-run");

const FIXED_NOW = "2026-01-01T00:00:00.000Z";

export function nowIso() {
  return MOCK ? FIXED_NOW : new Date().toISOString();
}

// Real mode uses the clock; mock mode a fixed token, so two runs of the same
// script (or of the pre-split and post-split versions) are byte-identical.
export function runStamp(prefix = "") {
  return `${prefix}${MOCK ? "mockrun" : Date.now().toString()}`;
}

// Same, for scripts that used a base-36 run id (private-beta-health).
export function runStamp36(prefix = "") {
  return `${prefix}${MOCK ? "mockrun" : Date.now().toString(36)}`;
}
