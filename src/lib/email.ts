import { Resend } from "resend";
import type { Bindings } from "../env";

/**
 * Environments where a missing RESEND_API_KEY may fall back to logging the
 * code locally. Allow-listed rather than deny-listed: an unset or unknown
 * WAZOO_ENV is treated as deployed, so a lost binding fails loudly instead of
 * writing one-time passwords into Worker logs (wazoo-api#90).
 */
const LOCAL_ENVS = new Set(["dev", "test"]);

export async function sendOtpEmail(
  email: string,
  otp: string,
  env: Bindings,
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    if (!LOCAL_ENVS.has(env.WAZOO_ENV ?? "")) {
      throw new Error(
        "RESEND_API_KEY is not configured; refusing to send a verification code",
      );
    }
    console.log(`[DEV] OTP for ${email}: ${otp}`);
    return;
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const from = env.OTP_FROM_ADDRESS ?? "Wazoo <noreply@mail.wazoo.dev>";

  await resend.emails.send({
    from,
    to: email,
    subject: "Your Wazoo verification code",
    html: `<p>Your verification code is: <strong>${otp}</strong></p><p>It expires in 5 minutes.</p>`,
  });
}
