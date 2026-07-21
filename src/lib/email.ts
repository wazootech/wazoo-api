import { Resend } from "resend";
import type { Bindings } from "../env";

export async function sendOtpEmail(
  email: string,
  otp: string,
  env: Bindings,
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`[DEV] OTP for ${email}: ${otp}`);
    return;
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const from = env.OTP_FROM_ADDRESS ?? "Wazoo <noreply@wazoo.dev>";

  await resend.emails.send({
    from,
    to: email,
    subject: "Your Wazoo verification code",
    html: `<p>Your verification code is: <strong>${otp}</strong></p><p>It expires in 5 minutes.</p>`,
  });
}
