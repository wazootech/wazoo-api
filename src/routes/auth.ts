import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { createToken, sha256Hex } from "../lib/crypto";
import { db, id } from "../lib/db";
import { hashPassword, verifyPassword } from "../lib/password";
import { rateLimitIp, rateLimitEmail } from "../lib/ratelimit";
import { getApprovedEmails } from "../lib/beta-allowlist";
import { sendOtpEmail } from "../lib/email";
import { respond } from "../lib/http";

const defaultPlatformScopes =
  "users.read worlds.read worlds.write usage.read billing.read";

export function registerAuthRoutes(app: OpenAPIHono<AppEnv>) {
  app.post("/v1/auth/login", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!email) {
      return c.json({ ok: true });
    }

    const ip =
      c.req.header("cf-connecting-ip") ??
      c.req.header("x-forwarded-for") ??
      "unknown";
    if (rateLimitIp(ip)) {
      return c.json({ ok: true });
    }
    if (rateLimitEmail(email, "login")) {
      return c.json({ ok: true });
    }

    const sheetId = c.env.BETA_ALLOWLIST_SHEET_ID;
    const key = c.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    let approved: Set<string>;
    try {
      approved = await getApprovedEmails(key ?? "", sheetId);
    } catch {
      return c.json({ ok: true });
    }

    if (!approved.has(email)) {
      return c.json({ ok: true });
    }

    const otp = generateOtp();
    const hash = await hashPassword(otp);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const database = db(c.env);
    await database
      .prepare(
        "INSERT INTO email_otps (uid, email, otp_hash, expires_at) VALUES (?, ?, ?, ?)",
      )
      .bind(id(), email, hash, expiresAt)
      .run();

    c.executionCtx?.waitUntil(sendOtpEmail(email, otp, c.env));

    return c.json({ ok: true });
  });

  app.post("/v1/auth/verify", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const otp = typeof body.otp === "string" ? body.otp.trim() : "";

    if (!email || !otp) {
      return respond(
        c,
        {
          error: {
            code: "INVALID_ARGUMENT",
            message: "email and otp are required",
          },
        },
        400,
      );
    }

    if (rateLimitEmail(email, "verify")) {
      return respond(
        c,
        {
          error: {
            code: "RATE_LIMITED",
            message: "Too many attempts. Please try again later.",
          },
        },
        429,
      );
    }

    const database = db(c.env);
    const otpRow = await database
      .prepare(
        "SELECT uid, otp_hash, expires_at, attempts, verified FROM email_otps WHERE email = ? AND expires_at > ? AND verified = 0 ORDER BY create_time DESC LIMIT 1",
      )
      .bind(email, new Date().toISOString())
      .first<{
        uid: string;
        otp_hash: string;
        expires_at: string;
        attempts: number;
        verified: number;
      }>();

    if (!otpRow) {
      return respond(
        c,
        {
          error: {
            code: "NOT_FOUND",
            message: "No active verification code. Please request a new one.",
          },
        },
        401,
      );
    }

    await database
      .prepare("UPDATE email_otps SET attempts = attempts + 1 WHERE uid = ?")
      .bind(otpRow.uid)
      .run();

    if (otpRow.attempts >= 5) {
      return respond(
        c,
        {
          error: {
            code: "MAX_ATTEMPTS",
            message: "Too many failed attempts. Please request a new code.",
          },
        },
        401,
      );
    }

    const valid = await verifyPassword(otp, otpRow.otp_hash);
    if (!valid) {
      return respond(
        c,
        {
          error: { code: "INVALID_OTP", message: "Invalid verification code." },
        },
        400,
      );
    }

    await database
      .prepare("UPDATE email_otps SET verified = 1 WHERE uid = ?")
      .bind(otpRow.uid)
      .run();

    const existing = await database
      .prepare("SELECT uid FROM users WHERE email = ?")
      .bind(email)
      .first<{ uid: string }>();

    let userUid: string;
    if (existing) {
      userUid = existing.uid;
    } else {
      userUid = id();
      await database
        .prepare("INSERT INTO users (uid, email) VALUES (?, ?)")
        .bind(userUid, email)
        .run();
    }

    const token = createToken("wzp");
    const tokenId = id();
    await database
      .prepare(
        "INSERT INTO platform_api_tokens (uid, user_uid, name, token_hash, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(
        tokenId,
        userUid,
        `login-${Date.now()}`,
        await sha256Hex(token),
        defaultPlatformScopes,
        null,
      )
      .run();

    return respond(c, { token }, 201);
  });
}

function generateOtp(): string {
  const digits = new Uint8Array(6);
  crypto.getRandomValues(digits);
  return Array.from(digits, (b) => (b % 10).toString()).join("");
}
