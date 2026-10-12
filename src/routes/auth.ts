import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { WorkOS } from "@workos-inc/node";
import { createToken, sha256Hex } from "../lib/crypto";
import { db, id } from "../lib/db";
import { rateLimit } from "../lib/ratelimit";
import { getApprovedEmails } from "../lib/beta-allowlist";
import { requireAuth, requireScope, respond } from "../lib/http";
import { SESSION_DEFAULT_SCOPES } from "../lib/scopes";
import {
  ErrorResponseSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  VerifyRequestSchema,
  VerifyResponseSchema,
  WorkosSessionRequestSchema,
  WorkosSessionResponseSchema,
} from "../lib/schemas";

const jsonError = (description: string) => ({
  description,
  content: { "application/json": { schema: ErrorResponseSchema } },
});

const loginRoute = createRoute({
  method: "post",
  path: "/v1/auth/login",
  tags: ["Auth"],
  operationId: "login",
  summary: "Start magic-link login",
  description:
    "Sends a one-time code to an allowlisted email. Unauthenticated; limited to 5 requests per minute per IP. Missing, rate-limited, and unconfigured cases return 200 `{ ok: true }` so the endpoint does not reveal which emails exist.",
  "x-mint": { metadata: { title: "Start magic-link login" } },
  security: [],
  request: {
    body: {
      content: { "application/json": { schema: LoginRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Request accepted",
      content: { "application/json": { schema: LoginResponseSchema } },
    },
    403: jsonError("Email is not on the private beta allowlist"),
  },
});

const verifyRoute = createRoute({
  method: "post",
  path: "/v1/auth/verify",
  tags: ["Auth"],
  operationId: "verifyLogin",
  summary: "Redeem login code for a session token",
  description:
    "Redeems the WorkOS magic-auth code and mints a `wzp_` session token. Unauthenticated; limited to 10 requests per minute per IP.",
  "x-mint": { metadata: { title: "Redeem login code" } },
  security: [],
  request: {
    body: {
      content: { "application/json": { schema: VerifyRequestSchema } },
    },
  },
  responses: {
    201: {
      description: "Session token",
      content: { "application/json": { schema: VerifyResponseSchema } },
    },
    400: jsonError(
      "INVALID_ARGUMENT, INVALID_CODE, EXPIRED, or AGE_GATE_REQUIRED",
    ),
    401: jsonError("Authentication failed"),
    429: jsonError("Too many attempts"),
    500: jsonError("Auth is not configured"),
  },
});

const workosSessionRoute = createRoute({
  method: "post",
  path: "/v1/auth/workos-session",
  tags: ["Auth"],
  operationId: "createWorkosSession",
  summary: "Mint a console session token (admin)",
  description:
    "Admin-only. Mints a 30-day console session token for an arbitrary email, creating the user when needed. Requires the `admin` scope.",
  "x-mint": { metadata: { title: "Mint console session token" } },
  security: [{ bearerPlatformToken: [] }],
  request: {
    body: {
      content: { "application/json": { schema: WorkosSessionRequestSchema } },
    },
  },
  responses: {
    201: {
      description: "Console session token",
      content: { "application/json": { schema: WorkosSessionResponseSchema } },
    },
    400: jsonError("INVALID_ARGUMENT or AGE_GATE_REQUIRED"),
    401: jsonError("Missing or invalid platform token"),
    403: jsonError("Admin scope required"),
  },
});

export function registerAuthRoutes(app: OpenAPIHono<AppEnv>) {
  // These handlers parse bodies leniently (a malformed body is treated as
  // empty) and sit ahead of the /v1/* auth middleware. They are registered
  // with plain `app.post` and documented via the registry so that adding the
  // OpenAPI metadata cannot change runtime validation behavior.
  for (const route of [loginRoute, verifyRoute, workosSessionRoute]) {
    app.openAPIRegistry.registerPath(route);
  }

  app.post("/v1/auth/workos-session", async (c) => {
    await requireAuth(c, async () => {});
    requireScope(c, "admin");

    const body = await c.req.json().catch(() => ({}));
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const displayName =
      typeof body.displayName === "string" && body.displayName.trim()
        ? body.displayName.trim()
        : null;
    const ageConfirmed =
      typeof body.ageConfirmed === "boolean" ? body.ageConfirmed : false;

    if (!email) {
      return respond(
        c,
        {
          error: {
            code: "INVALID_ARGUMENT",
            message: "email is required",
          },
        },
        400,
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
      if (displayName) {
        await database
          .prepare("UPDATE users SET display_name = ? WHERE uid = ?")
          .bind(displayName, userUid)
          .run();
      }
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
          "INSERT INTO users (uid, email, display_name, age_confirmed_at) VALUES (?, ?, ?, ?)",
        )
        .bind(userUid, email, displayName, new Date().toISOString())
        .run();
    }

    const token = createToken("wzp");
    const tokenId = id();
    const expiresAt = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await database
      .prepare(
        "INSERT INTO platform_api_tokens (uid, user_uid, name, token_hash, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(
        tokenId,
        userUid,
        `console-session-${Date.now()}`,
        await sha256Hex(token),
        SESSION_DEFAULT_SCOPES,
        expiresAt,
      )
      .run();

    return respond(c, { token, expiresAt }, 201);
  });

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
    } catch (error) {
      // Fail closed: the allowlist could not be read, so nobody is approved.
      // `{ ok: true }` rather than an error keeps this endpoint from becoming
      // an oracle for which emails are on the beta list.
      console.error(
        "[beta-allowlist] could not load allowlist; denying",
        error,
      );
      return c.json({ ok: true });
    }

    if (!approved.has(email)) {
      return respond(
        c,
        {
          error: {
            code: "NOT_ALLOWLISTED",
            message:
              "Email is not approved for the Wazoo Private Beta. Please request access to join.",
          },
        },
        403,
      );
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
        SESSION_DEFAULT_SCOPES,
        null,
      )
      .run();

    return respond(c, { token }, 201);
  });
}
