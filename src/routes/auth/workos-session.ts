import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../env";
import { createToken, sha256Hex } from "../../lib/crypto";
import { db, id } from "../../lib/db";
import { requireAuth, requireScope, respond } from "../../lib/http";
import { SESSION_DEFAULT_SCOPES } from "../../lib/scopes";

export function registerWorkosSession(app: OpenAPIHono<AppEnv>) {
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
}
