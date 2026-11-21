import { describe, expect, it } from "vitest";
import { corsOrigin } from "../src/lib/cors-origin";

const preview = "https://pr-previews.preview.console.wazoo.dev";
const versionPreview = "https://a1b2c3d4.preview.console.wazoo.dev";

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
    expect(corsOrigin(versionPreview, "qa")).toBe(versionPreview);
  });

  it("denies console preview origins on prod and when the env is unset", () => {
    // The blanket .wazoo.dev rule would otherwise let these through.
    expect(corsOrigin(preview, "prod")).toBeNull();
    expect(corsOrigin(versionPreview, undefined)).toBeNull();
  });

  it("denies lookalike and unrelated origins", () => {
    for (const origin of [
      undefined,
      "",
      "https://evil.workers.dev",
      "http://pr-previews.preview.console.wazoo.dev",
      "https://pr-previews.preview.console.wazoo.dev.evil.com",
      "https://a.b.preview.console.wazoo.dev",
      "https://preview.console.wazoo.dev",
      "https://wazoo-console-preview.ethan-r-davidson.workers.dev",
    ]) {
      expect(corsOrigin(origin, "qa")).toBeNull();
    }
  });
});
