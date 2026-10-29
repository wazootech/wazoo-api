import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../env";
import { createToken, sha256Hex } from "../../lib/crypto";
import { db, id } from "@/lib/db";
import { requireScope, respond } from "@/lib/http";
import { DELETION_TOKEN_TTL_MS, requireUserToken } from "./shared";

const initiateDeletionRoute = createRoute({
  method: "post",
  path: "/v1/users/me/deletion",
  tags: ["Users"],
  operationId: "initiateAccountDeletion",
  summary:
    "Initiate account deletion (returns a short-lived confirmation token)",
  "x-mint": { metadata: { title: "Initiate account deletion" } },
  security: [{ bearerPlatformToken: [] }],
  responses: {
    201: {
      description: "Deletion initiated",
      content: {
        "application/json": {
          schema: z.object({
            deletion: z.object({
              uid: z.string(),
              expiresAt: z.string(),
            }),
            // Held by the client for the confirm step; the server stores only
            // a hash. Mirrors the email-confirmation pattern.
            confirmationToken: z.string(),
            message: z.string(),
          }),
        },
      },
    },
    401: {
      description: "Not authenticated as a user",
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({ code: z.string(), message: z.string() }),
          }),
        },
      },
    },
  },
});

export function registerInitiateDeletion(app: OpenAPIHono<AppEnv>) {
  app.openapi(initiateDeletionRoute, async (c) => {
    requireScope(c, "users.write");
    const { userUid } = requireUserToken(c);

    const database = db(c.env);
    const existing = await database
      .prepare("SELECT uid FROM users WHERE uid = ? AND state = 'active'")
      .bind(userUid)
      .first<{ uid: string }>();
    if (!existing) {
      return respond(
        c,
        { error: { code: "NOT_FOUND", message: "User not found" } },
        404,
      );
    }

    // Invalidate any prior pending request for this user (one active token).
    await database
      .prepare("DELETE FROM deletion_requests WHERE user_uid = ?")
      .bind(userUid)
      .run();

    const requestUid = id();
    const token = createToken("wzdel");
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(
      Date.now() + DELETION_TOKEN_TTL_MS,
    ).toISOString();
    await database
      .prepare(
        "INSERT INTO deletion_requests (uid, user_uid, token_hash, expires_at) VALUES (?, ?, ?, ?)",
      )
      .bind(requestUid, userUid, tokenHash, expiresAt)
      .run();

    return respond(
      c,
      {
        deletion: { uid: requestUid, expiresAt },
        confirmationToken: token,
        message:
          "Account deletion requested. Confirm within 15 minutes to permanently delete the account and its data.",
      },
      201,
    );
  });
}
