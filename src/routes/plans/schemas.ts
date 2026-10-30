import { z } from "@hono/zod-openapi";
import { PLAN_NAMES } from "../../lib/plans";

export const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export const PlanSchema = z.enum(PLAN_NAMES).openapi({
  description: "The user's plan. It sets their daily database write budget.",
});

export const UserPlanSchema = z
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
