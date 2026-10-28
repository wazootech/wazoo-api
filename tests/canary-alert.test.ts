import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

// scripts/canary-alert.sh opens, updates, or closes the "Production canary
// failing" issue. These run the real script with a stub `gh` that records its
// arguments, so nothing reaches GitHub.

const hasBash = spawnSync("bash", ["--version"]).status === 0;
const SCRIPT = join(process.cwd(), "scripts", "canary-alert.sh");
const RUN_URL = "https://github.com/wazootech/wazoo-api/actions/runs/42";

type Call = string[];

describe.skipIf(!hasBash)("canary-alert.sh", () => {
  let dir: string;
  let log: string;
  let failFile: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "canary-alert-"));
    log = join(dir, "gh.log");
    failFile = join(dir, "canary.err");
    const stub = join(dir, "gh");
    writeFileSync(
      stub,
      [
        "#!/usr/bin/env bash",
        'printf "%s\\n" "$@" >> "$GH_STUB_LOG"',
        'printf "=====\\n" >> "$GH_STUB_LOG"',
        'if [[ "$1 $2" == "issue list" ]]; then printf "%s" "${GH_STUB_OPEN:-}"; fi',
        "",
      ].join("\n"),
    );
    chmodSync(stub, 0o755);
  });

  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup of the temp directory.
    }
  });

  beforeEach(() => {
    writeFileSync(log, "");
    writeFileSync(failFile, "FAIL api /ready: status 503\nok   api /health\n");
  });

  function run(env: Record<string, string>) {
    const pathKey =
      Object.keys(process.env).find((k) => k.toLowerCase() === "path") ??
      "PATH";
    const result = spawnSync("bash", [SCRIPT], {
      encoding: "utf8",
      env: {
        ...process.env,
        [pathKey]: `${dir}${delimiter}${process.env[pathKey] ?? ""}`,
        GH_STUB_LOG: log,
        RUN_URL,
        FAIL_FILE: failFile,
        ALERT_MENTION: "",
        GH_STUB_OPEN: "",
        ...env,
      },
    });
    const calls: Call[] = readFileSync(log, "utf8")
      .split("=====\n")
      .filter(Boolean)
      .map((chunk) => chunk.replace(/\n$/, "").split("\n"));
    return { status: result.status, stderr: result.stderr, calls };
  }

  /** The value after `--body`, which may span lines. */
  const bodyOf = (call: Call) => {
    const i = call.indexOf("--body");
    return call.slice(i + 1).join("\n");
  };
  const verbs = (calls: Call[]) => calls.map((c) => `${c[0]} ${c[1]}`);

  it("opens an issue with the failing checks when none is open", () => {
    const { status, calls } = run({ CANARY_RESULT: "failure" });
    expect(status).toBe(0);
    expect(verbs(calls)).toEqual(["issue list", "issue create"]);
    const create = calls[1]!;
    expect(create).toContain("Production canary failing");
    const body = bodyOf(create);
    expect(body.startsWith("The scheduled production canary failed.")).toBe(
      true,
    );
    expect(body).toContain(RUN_URL);
    expect(body).toContain("FAIL api /ready: status 503");
    expect(body).not.toContain("ok   api /health");
  });

  it("mentions the configured handles in a new issue", () => {
    const { calls } = run({
      CANARY_RESULT: "failure",
      ALERT_MENTION: "@EthanThatOneKid @wazootech/oncall",
    });
    expect(
      bodyOf(calls[1]!).startsWith(
        "@EthanThatOneKid @wazootech/oncall The scheduled production canary failed.",
      ),
    ).toBe(true);
  });

  it("comments on the open issue instead of opening another, and mentions again", () => {
    const { calls } = run({
      CANARY_RESULT: "failure",
      GH_STUB_OPEN: "7",
      ALERT_MENTION: "@EthanThatOneKid",
    });
    expect(verbs(calls)).toEqual(["issue list", "issue comment"]);
    expect(calls[1]![2]).toBe("7");
    expect(bodyOf(calls[1]!).startsWith("@EthanThatOneKid ")).toBe(true);
  });

  it("comments and closes when the canary recovers", () => {
    const { calls } = run({
      CANARY_RESULT: "success",
      GH_STUB_OPEN: "7",
      ALERT_MENTION: "@EthanThatOneKid",
    });
    expect(verbs(calls)).toEqual([
      "issue list",
      "issue comment",
      "issue close",
    ]);
    expect(bodyOf(calls[1]!)).toBe(
      `@EthanThatOneKid Recovered: the canary passed. Run: ${RUN_URL}`,
    );
    expect(calls[2]).toEqual(["issue", "close", "7", "--reason", "completed"]);
  });

  it("does nothing on success when no issue is open", () => {
    const { status, calls } = run({ CANARY_RESULT: "success" });
    expect(status).toBe(0);
    expect(verbs(calls)).toEqual(["issue list"]);
  });

  it("works without a mention, as before", () => {
    const { calls } = run({ CANARY_RESULT: "failure", GH_STUB_OPEN: "3" });
    expect(
      bodyOf(calls[1]!).startsWith("The scheduled production canary"),
    ).toBe(true);
  });

  it("ignores a mention that is not a list of handles", () => {
    for (const bad of [
      "everyone",
      "@a; echo pwned",
      "$(whoami)",
      "@a @",
      " @a",
      "@a\n@b",
      "@a `id`",
    ]) {
      const { status, stderr, calls } = run({
        CANARY_RESULT: "failure",
        ALERT_MENTION: bad,
      });
      expect(status, bad).toBe(0);
      expect(stderr, bad).toContain("ignoring it");
      const body = bodyOf(calls[1]!);
      expect(
        body.startsWith("The scheduled production canary failed."),
        bad,
      ).toBe(true);
      expect(body, bad).not.toContain("pwned");
    }
  });

  it("explains an empty failure file", () => {
    writeFileSync(failFile, "");
    const { calls } = run({ CANARY_RESULT: "failure" });
    expect(bodyOf(calls[1]!)).toContain(
      "(no FAIL lines captured; see the run log)",
    );
  });
});
