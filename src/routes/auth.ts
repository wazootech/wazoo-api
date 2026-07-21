import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { WorkOS } from "@workos-inc/node";
import { createToken, sha256Hex } from "../lib/crypto";
import { db, id } from "../lib/db";
import { rateLimit } from "../lib/ratelimit";
import { getApprovedEmails } from "../lib/beta-allowlist";
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
    if (await rateLimit(c.env, `login:ip:${ip}`, 5, 60_000)) {
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

    const apiKey = c.env.WORKOS_API_KEY;
    if (!apiKey) {
      return c.json({ ok: true });
    }

    const workos = new WorkOS(apiKey);
    try {
      await workos.userManagement.createMagicAuth({ email });
    } catch {
      return c.json({ ok: true });
    }

    return c.json({ ok: true });
  });

  app.post("/v1/auth/verify", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";

    if (!body.email || !body.code) {
      const keys = Object.keys(body);
      return respond(
        c,
        {
          error: {
            code: "INVALID_ARGUMENT",
            message: `email and code are required. got: ${JSON.stringify(keys)} raw: ${JSON.stringify(body)}`,
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
    let workosUser: { id: string; email: string };
    try {
      const result = await workos.userManagement.authenticateWithMagicAuth({
        clientId,
        code,
        email,
      });
      workosUser = result.user;
    } catch (err: any) {
      const message = err?.message ?? String(err);
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
