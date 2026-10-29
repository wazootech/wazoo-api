import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../env";
import { sha256Hex } from "../../lib/crypto";
import { db } from "@/lib/db";
import { requireScope, respond } from "@/lib/http";
import { stripeDelete } from "@/lib/stripe";
import { deleteNamespaceWorlds } from "@worlds/client";
import { worldsAdminClient } from "@/lib/worlds-client";
import { requireUserToken } from "./shared";

import { confirmDeletionRoute } from "./confirm-deletion-route";

export function registerConfirmDeletion(app: OpenAPIHono<AppEnv>) {
  app.openapi(confirmDeletionRoute, async (c) => {
    requireScope(c, "users.write");
    const { userUid } = requireUserToken(c);
    const body = c.req.valid("json");
    const database = db(c.env);

    const tokenHash = await sha256Hex(body.confirmationToken);
    const pending = await database
      .prepare(
        "SELECT uid, expires_at FROM deletion_requests WHERE user_uid = ? AND token_hash = ?",
      )
      .bind(userUid, tokenHash)
      .first<{ uid: string; expires_at: string }>();

    if (!pending) {
      return respond(
        c,
        {
          error: {
            code: "INVALID_ARGUMENT",
            message: "Invalid confirmation token",
          },
        },
        400,
      );
    }
    if (new Date(pending.expires_at).getTime() <= Date.now()) {
      await database
        .prepare("DELETE FROM deletion_requests WHERE uid = ?")
        .bind(pending.uid)
        .run();
      return respond(
        c,
        {
          error: {
            code: "INVALID_ARGUMENT",
            message: "Confirmation token expired. Start deletion again.",
          },
        },
        400,
      );
    }

    // Stop billing before anything is destroyed: a Pro user must never be
    // charged for an account that no longer exists. A failed cancel blocks the
    // deletion so the user can retry. The Stripe customer is kept on purpose
    // (invoices and tax records), and a subscription Stripe no longer knows
    // (404) is already gone.
    const billing = await database
      .prepare("SELECT stripe_subscription_id FROM users WHERE uid = ?")
      .bind(userUid)
      .first<{ stripe_subscription_id: string | null }>();
    if (billing?.stripe_subscription_id) {
      const canceled = await stripeDelete(
        c.env,
        `/v1/subscriptions/${encodeURIComponent(billing.stripe_subscription_id)}`,
      );
      if (!canceled.ok && canceled.status !== 404) {
        console.error(
          `account deletion blocked: could not cancel subscription (${canceled.status}): ${canceled.message}`,
        );
        return respond(
          c,
          {
            error: {
              code: "BILLING_CANCEL_FAILED",
              message:
                "Could not cancel your subscription, so the account was not deleted. Please try again.",
            },
          },
          502,
        );
      }
    }

    // Mark every world for this user (namespace) deleted in worlds-api so the
    // purge sweep destroys the underlying databases after the grace period.
    const worldsRes = await deleteNamespaceWorlds({
      client: worldsAdminClient(c.env),
      path: { namespace: userUid },
    });
    if (worldsRes.error) {
      return respond(
        c,
        {
          error: {
            code: "WORLD_DELETE_FAILED",
            message: "Could not mark worlds for deletion. Please try again.",
          },
        },
        502,
      );
    }

    // Hard-delete the user. FK cascades remove their worlds mirror rows
    // (worlds.user_uid), platform tokens (platform_api_tokens.user_uid), and
    // usage events (usage_events.user_uid); the per-world databases themselves
    // are destroyed by worlds-api's purge sweep after the grace period.
    await database
      .prepare("DELETE FROM users WHERE uid = ?")
      .bind(userUid)
      .run();

    return c.body(null, 204);
  });
}
