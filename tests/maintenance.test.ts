import { describe, expect, it } from "vitest";
import app from "../src/index";
import type { AppEnv } from "../src/env";

describe("cutover maintenance", () => {
  it("rejects API traffic while maintenance is enabled", async () => {
    const env = {
      CUTOVER_MAINTENANCE: "true",
    } as unknown as AppEnv["Bindings"];

    const response = await app.request("/health", {}, env);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "MAINTENANCE",
        message: "Cutover maintenance in progress",
      },
    });
  });
});
