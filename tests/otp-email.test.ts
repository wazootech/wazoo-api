import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../src/env";

const send = vi.fn().mockResolvedValue({ data: { id: "email-1" } });
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

const { sendOtpEmail } = await import("../src/lib/email");

const OTP = "424242";
const EMAIL = "user@example.com";

function env(overrides: Partial<Bindings>): Bindings {
  return { DB: {} as Bindings["DB"], ...overrides } as Bindings;
}

describe("sendOtpEmail fails closed without RESEND_API_KEY (wazoo-api#90)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    send.mockClear();
  });

  for (const wazooEnv of ["prod", "qa", undefined, "staging"]) {
    it(`throws and never logs the code when WAZOO_ENV is ${String(wazooEnv)}`, async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(
        sendOtpEmail(EMAIL, OTP, env({ WAZOO_ENV: wazooEnv })),
      ).rejects.toThrow(/RESEND_API_KEY is not configured/);
      const logged = [...log.mock.calls, ...error.mock.calls].flat().join(" ");
      expect(logged).not.toContain(OTP);
      expect(send).not.toHaveBeenCalled();
    });
  }

  for (const wazooEnv of ["dev", "test"]) {
    it(`logs the code locally when WAZOO_ENV is ${wazooEnv}`, async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      await sendOtpEmail(EMAIL, OTP, env({ WAZOO_ENV: wazooEnv }));
      expect(log.mock.calls.flat().join(" ")).toContain(OTP);
      expect(send).not.toHaveBeenCalled();
    });
  }

  it("sends through Resend when the key is configured, even in prod", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await sendOtpEmail(
      EMAIL,
      OTP,
      env({ WAZOO_ENV: "prod", RESEND_API_KEY: "re_test" }),
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toBe(EMAIL);
    expect(log.mock.calls.flat().join(" ")).not.toContain(OTP);
  });
});
