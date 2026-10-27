import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../env";
import { recordAdminAudit } from "../lib/audit";
import { db, first } from "../lib/db";
import { requireScope, resolveUser, respond } from "../lib/http";
import {
  PLAN_NAMES,
  planDailyRowWrites,
  readPlanUsage,
  setUserPlan,
  userPlan,
} from "../lib/plans";

const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const PlanSchema = z.enum(PLAN_NAMES).openapi({
  description: "The user's plan. It sets their daily database write budget.",
});

const UserPlanSchema = z
  .object({
    plan: PlanSchema,
    dailyRowWrites: z.number().int().positive().nullable().openapi({
      description:
        "Database rows the user's worlds may write per UTC day, shared across all of them. A stored quad costs about 9 rows, and about 94 per asserted quad with inference on. Null if the data plane could not be reached.",
    }),
    rowsWrittenToday: z.number().int().nonnegative().nullable().openapi({
      description:
        "Rows written so far today (UTC), or null if the data plane could not be reached.",
    }),
    usagePercent: z.number().int().nonnegative().nullable(),
    day: z.string().nullable().openapi({ description: "The UTC day." }),
    billing: z
      .object({
        checkoutAvailable: z.boolean().openapi({
          description:
            "True when this user can start a Pro checkout: billing is configured and they are on the free plan.",
        }),
        portalAvailable: z.boolean().openapi({
          description:
            "True when the user has a billing account to manage in the Stripe portal.",
        }),
      })
      .openapi({ description: "What the console may offer." }),
  })
  .openapi("UserPlan");

const getPlanRoute = createRoute({
  method: "get",
  path: "/v1/users/me/plan",
  tags: ["Users"],
  operationId: "getUserPlan",
  summary: "Get the authenticated user's plan and today's write usage",
  "x-mint": { metadata: { title: "Get plan and write usage" } },
  security: [{ bearerPlatformToken: [] }],
  responses: {
    200: {
      description: "The plan and usage against its daily write budget",
      content: { "application/json": { schema: UserPlanSchema } },
    },
    404: {
      description: "User not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

const setPlanRoute = createRoute({
  method: "put",
  path: "/v1/admin/users/{userUid}/plan",
  tags: ["Admin"],
  operationId: "setUserPlan",
  summary: "Set a user's plan",
  description:
    "Admin-only. Stores the plan and applies its daily write budget in the data plane. Idempotent: if the data plane cannot be reached the plan is still saved, the call returns 502 BUDGET_SYNC_FAILED, and repeating it retries the sync.",
  "x-mint": { metadata: { title: "Set a user's plan" } },
  security: [{ bearerPlatformToken: [] }],
  request: {
    params: z.object({
      userUid: z
        .string()
        .min(1)
        .openapi({
          param: { name: "userUid", in: "path", required: true },
        }),
    }),
    body: {
      required: true,
      content: {
        "application/json": { schema: z.object({ plan: PlanSchema }) },
      },
    },
  },
  responses: {
    200: {
      description: "The plan now in effect",
      content: {
        "application/json": {
          schema: z.object({
            userUid: z.string(),
            plan: PlanSchema,
            dailyRowWrites: z.number().int().positive(),
          }),
        },
      },
    },
    404: {
      description: "User not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
    502: {
      description:
        "The plan was saved but the data plane did not accept its budget (BUDGET_SYNC_FAILED). Repeat the call.",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

export function registerPlanRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(getPlanRoute, async (c) => {
    requireScope(c, "usage.read");
    const user = await resolveUser(c);
    const plan = await userPlan(c.env, user.uid);
    const usage = await readPlanUsage(c.env, user.uid);
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
