import { describe, expect, it } from "vitest";
import { corsOrigin } from "../src/lib/cors-origin";

const preview = "https://wazoo-console-preview.ethan-r-davidson.workers.dev";
const branchPreview =
  "https://pr-previews-wazoo-console-preview.ethan-r-davidson.workers.dev";

describe("corsOrigin", () => {
  it("allows wazoo.dev subdomains and localhost in every env", () => {
    for (const env of ["prod", "qa", undefined]) {
      expect(corsOrigin("https://console.wazoo.dev", env)).toBe(
        "https://console.wazoo.dev",
      );
      expect(corsOrigin("http://localhost:3000", env)).toBe(
        "http://localhost:3000",
      );
    }
  });

  it("allows console preview origins on QA only", () => {
    expect(corsOrigin(preview, "qa")).toBe(preview);
    expect(corsOrigin(branchPreview, "qa")).toBe(branchPreview);
    expect(corsOrigin(preview, "prod")).toBeNull();
    expect(corsOrigin(branchPreview, undefined)).toBeNull();
  });

  it("denies lookalike and unrelated origins", () => {
    for (const origin of [
      undefined,
      "",
      "https://evil.workers.dev",
      "http://wazoo-console-preview.ethan-r-davidson.workers.dev",
      "https://wazoo-console-preview.ethan-r-davidson.workers.dev.evil.com",
      "https://x.wazoo-console-preview.ethan-r-davidson.workers.dev",
      "https://wazoo-console-preview.someone-else.workers.dev",
    ]) {
      expect(corsOrigin(origin, "qa")).toBeNull();
    }
  });
});
