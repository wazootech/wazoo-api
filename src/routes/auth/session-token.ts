import type { Context } from "hono";
import type { AppEnv } from "../../env";
import { createToken, sha256Hex } from "../../lib/crypto";
import { db, id } from "../../lib/db";
import { respond } from "../../lib/http";
import { SESSION_DEFAULT_SCOPES } from "../../lib/scopes";

// Mints a session platform token for `userUid` and returns the 201 response.
export async function issueSessionToken(c: Context<AppEnv>, userUid: string) {
  const database = db(c.env);
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
}
