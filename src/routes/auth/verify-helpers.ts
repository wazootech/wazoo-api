import type { Context } from "hono";
import { WorkOS } from "@workos-inc/node";
import type { AppEnv } from "../../env";
import { db, id } from "../../lib/db";
import { respond } from "../../lib/http";

/** Redeems the magic-auth code; returns an error Response, or null on success. */
export async function redeemCode(
  c: Context<AppEnv>,
  apiKey: string,
  clientId: string,
  email: string,
  code: string,
): Promise<Response | null> {
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

  return null;
}

/** Returns the user uid, or an error Response (age gate) for a new account. */
export async function findOrCreateUser(
  c: Context<AppEnv>,
  email: string,
  ageConfirmed: boolean,
): Promise<string | Response> {
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

  return userUid;
}
