import { z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../env";
import { recordAdminAudit } from "../../lib/audit";
import { db, first, now } from "../../lib/db";
import { isAdmin, requireScope, respond } from "../../lib/http";
import { quotaError, quotaStatus } from "../../lib/quota";
import { syncPlanBudget, userPlan } from "../../lib/plans";
import { createApiKey, createWorld } from "@worlds/client";
import {
  worldsAdminClient,
  worldsApiError,
  worldsApiErrorDetail,
} from "../../lib/worlds-client";
import { worldId as worldIdSchema } from "../../lib/schemas";
import { insertWorldRow } from "./insert";
import { createRouteDef } from "./create-route";
import { currentUser, worldResource, type WorldRow } from "./shared";

export function registerCreateWorld(app: OpenAPIHono<AppEnv>) {
  app.openapi(createRouteDef, async (c) => {
    requireScope(c, "worlds.write");
    const body = c.req.valid("json");
    const user = await currentUser(c, body.ownerEmail, body.email);
    const quota = await quotaStatus(c, user.uid);
    if (!isAdmin(c) && quota.state === "THROTTLED") {
      return quotaError(
        c,
        "User has reached the private beta World limit",
        quota,
      );
    }

    const database = db(c.env);

    const client = worldsAdminClient(c.env);

    // Mint a namespace-scoped worlds-api key so tenancy is derived from auth
    // (the key's namespace), never from a request body field.
    const keyRes = await createApiKey({
      client,
      body: {
        namespace: user.uid,
        name: "wazoo-api world provisioning",
      },
    });
    if (keyRes.error) {
      return respond(
        c,
        {
          error: {
            code: "WORLD_PROVISIONING_FAILED",
            message: worldsApiError(keyRes),
          },
        },
        502,
      );
    }
    const mintedKey = keyRes.data;

    // Apply the user's plan budget in the data plane (idempotent). A failure
    // must not block world creation: the PUT /v1/admin/users/{uid}/plan call
    // repeats the sync, and worlds-api falls back to its default budget.
    const budgetSync = await syncPlanBudget(
      c.env,
      user.uid,
      await userPlan(c.env, user.uid),
    );
    if (!budgetSync.ok) {
      console.warn("plan budget sync failed at world creation", {
        detail: budgetSync.detail,
      });
    }

    const world = {
      displayName: body.world.displayName,
      region: body.world.region,
      now: now(),
    };

    const res = await createWorld({
      client,
      auth: mintedKey.token,
      body: {
        displayName: world.displayName,
      },
    });
    if (res.error) {
      const detail = worldsApiErrorDetail(res);
      return respond(
        c,
        {
          error: {
            code: "WORLD_PROVISIONING_FAILED",
            message: detail.message,
          },
        },
        502,
      );
    }
    const parsedWorld = z
      .object({ id: worldIdSchema })
      .passthrough()
      .safeParse(res.data as unknown);
    if (!parsedWorld.success) {
      return respond(
        c,
        {
          error: {
            code: "WORLD_PROVISIONING_FAILED",
            message: "worlds-api did not return a canonical world ID",
          },
        },
        502,
      );
    }
    const canonicalWorldId = parsedWorld.data.id;

    await insertWorldRow(database, {
      worldId: canonicalWorldId,
      userUid: user.uid,
      displayName: world.displayName,
      region: world.region,
      now: world.now,
    });

    if (isAdmin(c) && quota.state !== "OK" && quota.state !== "WARN") {
      await recordAdminAudit(c, {
        action: "worlds.create_quota_bypass",
        targetResourceName: `users/${user.uid}/worlds/${canonicalWorldId}`,
      });
    }

    const row = await first<WorldRow>(
      database
        .prepare("SELECT * FROM worlds WHERE world_id = ?")
        .bind(canonicalWorldId),
    );
    return respond(c, { world: row ? worldResource(row) : null }, 201);
  });
}
