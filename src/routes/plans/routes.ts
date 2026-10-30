import { createRoute, z } from "@hono/zod-openapi";
import { ErrorSchema, PlanSchema, UserPlanSchema } from "./schemas";

export const getPlanRoute = createRoute({
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

export const setPlanRoute = createRoute({
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
