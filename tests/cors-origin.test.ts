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

  it("requires https for wazoo.dev subdomains", () => {
    expect(corsOrigin("https://api.wazoo.dev", "prod")).toBe(
      "https://api.wazoo.dev",
    );
    expect(corsOrigin("http://console.wazoo.dev", "prod")).toBeNull();
    expect(corsOrigin("http://x.wazoo.dev", "qa")).toBeNull();
    expect(corsOrigin("ftp://x.wazoo.dev", "qa")).toBeNull();
  });

  it("still trusts nested wazoo.dev hosts until the allowlist lands", () => {
    // Tracked in wazootech/wazoo-api#178.
    expect(corsOrigin("https://a.b.wazoo.dev", "prod")).toBe(
      "https://a.b.wazoo.dev",
    );
  });

  it("denies lookalike wazoo.dev domains", () => {
    for (const origin of [
      "https://wazoo.dev",
      "https://wazoo.dev.evil.com",
      "https://evil-wazoo.dev",
      "https://evilwazoo.dev",
      "https://console.wazoo.dev.evil.com",
      "https://console.wazoo.devx",
      "https://wazoo.dev.",
      "https://.wazoo.dev",
    ]) {
      expect(corsOrigin(origin, "prod")).toBeNull();
    }
  });

  it("denies userinfo, ports, paths, and trailing characters", () => {
    for (const origin of [
      "https://a@wazoo.dev",
      "https://a@console.wazoo.dev",
      "https://console.wazoo.dev@evil.com",
      "https://evil.com\\@console.wazoo.dev",
      "https://console.wazoo.dev:8443",
      "https://console.wazoo.dev:443",
      "https://console.wazoo.dev/",
      "https://console.wazoo.dev/path",
      "https://console.wazoo.dev?x=1",
      "https://console.wazoo.dev ",
      " https://console.wazoo.dev",
      "https://CONSOLE.wazoo.dev",
      "console.wazoo.dev",
      "not a url",
    ]) {
      expect(corsOrigin(origin, "prod")).toBeNull();
    }
  });

  it("allows only http localhost with a port", () => {
    expect(corsOrigin("http://localhost:8787", "prod")).toBe(
      "http://localhost:8787",
    );
    for (const origin of [
      "http://localhost",
      "https://localhost:3000",
      "http://localhost:3000@evil.com",
      "http://localhost:3000/path",
      "http://evil-localhost:3000",
      "http://localhost.evil.com:3000",
    ]) {
      expect(corsOrigin(origin, "prod")).toBeNull();
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
