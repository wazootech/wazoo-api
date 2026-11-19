import { describe, expect, it } from "vitest";
import app from "../src/index";
import type { Bindings } from "../src/env";

const env = { WAZOO_ENV: "test" } as unknown as Bindings;
const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

describe("POST /v1/auth/workos-session (retired path)", () => {
  it("308-redirects to /v1/auth/workos so method and body survive", async () => {
    const res = await app.request(
      "/v1/auth/workos-session",
      { method: "POST", body: JSON.stringify({ email: "a@b.test" }) },
      env,
      executionCtx,
    );
    expect(res.status).toBe(308);
    expect(
      new URL(res.headers.get("location") ?? "", "http://x").pathname,
    ).toBe("/v1/auth/workos");
  });
});
