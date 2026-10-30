import type { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../../env";
import { recordAdminAudit } from "../../lib/audit";
import { db, first } from "../../lib/db";
import { requireScope, resolveUser, respond } from "../../lib/http";
import {
  planDailyRowWrites,
  readPlanUsageReconciled,
  setUserPlan,
  userPlan,
} from "../../lib/plans";
import { getPlanRoute, setPlanRoute } from "./routes";

export function registerPlanRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(getPlanRoute, async (c) => {
    requireScope(c, "usage.read");
    const user = await resolveUser(c);
    const plan = await userPlan(c.env, user.uid);
    const usage = await readPlanUsageReconciled(c.env, user.uid, plan);
    const dailyRowWrites = usage?.dailyRowWrites ?? null;
    const rowsWrittenToday = usage?.rowsWrittenToday ?? null;
    const row = await first<{ stripe_customer_id: string | null }>(
      db(c.env)
        .prepare("SELECT stripe_customer_id FROM users WHERE uid = ?")
        .bind(user.uid),
    ).catch(() => null);
    const billingOn = Boolean(
      c.env.STRIPE_SECRET_KEY && c.env.STRIPE_PRICE_ID && c.env.CONSOLE_URL,
    );
    return respond(c, {
      plan,
      billing: {
        checkoutAvailable: billingOn && plan === "free",
        portalAvailable: Boolean(
          c.env.STRIPE_SECRET_KEY && row?.stripe_customer_id,
        ),
      },
      dailyRowWrites,
      rowsWrittenToday,
      usagePercent:
        dailyRowWrites && rowsWrittenToday !== null
          ? Math.floor((rowsWrittenToday / dailyRowWrites) * 100)
          : null,
      day: usage?.day ?? null,
    });
  });

  app.openapi(setPlanRoute, async (c) => {
    requireScope(c, "admin");
    const userUid = c.req.param("userUid");
    const { plan } = c.req.valid("json");
    const user = await first<{ uid: string }>(
      db(c.env).prepare("SELECT uid FROM users WHERE uid = ?").bind(userUid),
    );
    if (!user) throw new HTTPException(404, { message: "User not found" });

    const sync = await setUserPlan(c.env, user.uid, plan);
    await recordAdminAudit(c, {
      action: "users.setPlan",
      targetResourceName: `users/${user.uid}`,
      outcome: sync.ok ? "SUCCESS" : "FAILED",
      errorCode: sync.ok ? null : "BUDGET_SYNC_FAILED",
    });
    if (!sync.ok) {
      return respond(
        c,
        {
          error: {
            code: "BUDGET_SYNC_FAILED",
            message: `The plan was saved but the data plane did not accept its budget: ${sync.detail}. Repeat the call to retry.`,
          },
        },
        502,
      );
    }
    return respond(c, {
      userUid: user.uid,
      plan,
      dailyRowWrites: planDailyRowWrites(c.env, plan),
    });
  });
}
