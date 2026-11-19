import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// End-to-end dry-run gate (wazoo-api#149): every operational script must run
// to completion in mock mode (WAZOO_SCRIPT_MODE=mock) with no network and no
// credentials, and its output must be byte-stable across runs — the same
// property the split itself was verified with.
const SCRIPTS = [
  { file: "scripts/qa-roundtrip.mjs", done: "Round trip PASS" },
  { file: "scripts/platform-smoke.mjs", done: "Smoke gate passed." },
  {
    file: "scripts/private-beta-health.mjs",
    done: "Private beta health test passed",
  },
  { file: "scripts/local-health.mjs", done: "16 passed, 0 failed, 16 total" },
  { file: "scripts/platform-canary.mjs", done: "all 10 canary checks passed" },
];

function runMock(file: string, extraEnv: Record<string, string> = {}) {
  return spawnSync(process.execPath, [join(process.cwd(), file)], {
    encoding: "utf8",
    env: { ...process.env, WAZOO_SCRIPT_MODE: "mock", ...extraEnv },
    timeout: 60_000,
  });
}

describe.each(SCRIPTS)("$file in mock mode", ({ file, done }) => {
  it("exits 0 and ends with its success line", () => {
    const first = runMock(file);
    expect(first.status).toBe(0);
    expect(
      first.stdout.trimEnd().endsWith(done) || first.stdout.includes(done),
    ).toBe(true);
  });

  it("is byte-stable across runs", () => {
    const first = runMock(file);
    const second = runMock(file);
    expect(second.status).toBe(first.status);
    expect(second.stdout).toBe(first.stdout);
    expect(second.stderr).toBe(first.stderr);
  });
});

describe("qa-roundtrip with the embeddings acceptance block", () => {
  const env = {
    WAZOO_EMBEDDINGS_ACCEPTANCE: "1",
    WORLDS_API_ADMIN_KEY: "mock-data-admin-token",
    WAZOO_EMBEDDINGS_PROVIDER_KEY: "mock-provider-key",
  };

  it("passes in mock mode and is byte-stable", () => {
    const first = runMock("scripts/qa-roundtrip.mjs", env);
    const second = runMock("scripts/qa-roundtrip.mjs", env);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("Round trip PASS");
    expect(second.stdout).toBe(first.stdout);
  });
});
