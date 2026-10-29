import { issueSessionToken } from "./session-token";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { WorkOS } from "@workos-inc/node";
import type { AppEnv } from "../../env";
import { db, id } from "../../lib/db";
import { rateLimit } from "../../lib/ratelimit";
import { respond } from "../../lib/http";

export function registerVerify(app: OpenAPIHono<AppEnv>) {
  app.post("/v1/auth/verify", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const ageConfirmed =
      typeof body.ageConfirmed === "boolean" ? body.ageConfirmed : false;

    if (!email || !code) {
      return respond(
        c,
        {
          error: {
            code: "INVALID_ARGUMENT",
            message: "email and code are required",
          },
        },
        400,
      );
    }

    const ip =
      c.req.header("cf-connecting-ip") ??
      c.req.header("x-forwarded-for") ??
      "unknown";
    if (await rateLimit(c.env, `verify:ip:${ip}`, 10, 60_000)) {
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

    const apiKey = c.env.WORKOS_API_KEY;
    const clientId = c.env.WORKOS_CLIENT_ID;
    if (!apiKey || !clientId) {
      return respond(
        c,
        { error: { code: "CONFIG_ERROR", message: "Auth is not configured." } },
        500,
      );
    }

    const workos = new WorkOS(apiKey);
    try {
      await workos.userManagement.authenticateWithMagicAuth({
        clientId,
        code,
        email,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("invalid")) {
        return respond(
          c,
          {
            error: {
              code: "INVALID_CODE",
              message: "Invalid verification code.",
            },
          },
          400,
        );
      }
      if (message.includes("expired")) {
        return respond(
          c,
          {
            error: {
              code: "EXPIRED",
              message: "Verification code has expired.",
            },
          },
          400,
        );
      }
      return respond(
        c,
        {
          error: { code: "AUTH_ERROR", message: "Authentication failed." },
        },
        401,
      );
    }

    const database = db(c.env);
    const existing = await database
      .prepare("SELECT uid FROM users WHERE email = ?")
      .bind(email)
      .first<{ uid: string }>();

    let userUid: string;
    if (existing) {
      userUid = existing.uid;
    } else {
      if (!ageConfirmed) {
        return respond(
          c,
          {
            error: {
              code: "AGE_GATE_REQUIRED",
              message:
                "You must confirm that you are at least 13 years old to create a Wazoo account.",
            },
          },
          400,
        );
      }
      userUid = id();
      await database
        .prepare(
          "INSERT INTO users (uid, email, age_confirmed_at) VALUES (?, ?, ?)",
        )
        .bind(userUid, email, new Date().toISOString())
        .run();
    }

    return issueSessionToken(c, userUid);
  });
}
