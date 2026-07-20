import { z } from "@hono/zod-openapi";

export const resourceId = z
  .string()
  .regex(/^[a-z][a-z0-9-]{2,62}$/)
  .openapi({ description: "Resource ID matching ^[a-z][a-z0-9-]{2,62}$" });

export const email = z.string().email();

export const nonEmptyString = z.string().min(1);

export const ErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
    }),
  })
  .openapi("ErrorResponse");

export const UserSchema = z
  .object({
    uid: z.string(),
    email: z.string().email(),
    displayName: z.string().nullable(),
    state: z.enum(["ACTIVE"]),
    createTime: z.string().datetime(),
  })
  .openapi("User");

export const WorldSchema = z
  .object({
    name: z.string(),
    uid: z.string(),
    worldId: z.string(),
    displayName: z.string(),
    region: z.string(),
    state: z.enum(["ACTIVE", "SUSPENDED", "DELETED"]),
    restorable: z.boolean(),
    backend: z.enum(["worlds-api"]),
    createTime: z.string().datetime().optional(),
    updateTime: z.string().datetime().optional(),
    deleteTime: z.string().datetime().optional(),
    expireTime: z.string().datetime().optional(),
  })
  .openapi("World");

export const WorldListSchema = z.object({
  worlds: z.array(WorldSchema),
});

export const WorldSingleSchema = z.object({
  world: WorldSchema,
});

export const CreateWorldBodySchema = z
  .object({
    ownerEmail: email.optional(),
    email: email.optional(),
    worldId: resourceId,
    world: z.object({
      displayName: nonEmptyString,
      region: z.string().optional().default("auto"),
    }),
  })
  .openapi("CreateWorldRequest");

export const UpdateWorldBodySchema = z
  .object({
    updateMask: z.string(),
    world: z.object({
      displayName: z.string().optional(),
      region: z.string().optional(),
      state: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
    }),
  })
  .openapi("UpdateWorldRequest");

export const SyncReportSchema = z
  .object({
    status: z.enum(["OK"]),
    actions: z.array(z.string()),
    warnings: z.array(z.string()),
    errors: z.array(z.string()),
  })
  .openapi("SyncReport");

export const SyncWorldResponseSchema = z.object({
  world: WorldSchema,
  syncReport: SyncReportSchema,
});

export const PlatformTokenSchema = z
  .object({
    uid: z.string(),
    name: z.string(),
    scope: z.string().optional(),
    last_used_at: z.string().datetime().nullable().optional(),
    expires_at: z.string().datetime().nullable().optional(),
    createTime: z.string().datetime().optional(),
  })
  .openapi("PlatformToken");

export const PlatformTokenListSchema = z.object({
  tokens: z.array(PlatformTokenSchema),
});

export const PlatformTokenCreateRequestSchema = z
  .object({
    user: z.string().optional(),
    email: email.optional(),
    name: z.string().optional(),
    tokenName: z.string().optional(),
    scope: z.string().optional(),
    expiresAt: z.string().datetime().optional(),
  })
  .openapi("PlatformTokenCreateRequest");

export const PlatformTokenCreateResponseSchema = z
  .object({
    uid: z.string(),
    name: z.string(),
    token: z.string(),
  })
  .openapi("PlatformTokenCreateResponse");

export const PlatformTokenDeleteResponseSchema = z.object({
  token: z.string(),
});

export const PlatformTokenValidateResponseSchema = z.object({
  exp: z.number().int(),
});

export const WorldTokenSchema = z
  .object({
    uid: z.string(),
    name: z.string(),
    namespace: z.string().optional(),
    worldId: z.string().optional(),
    scopes: z.array(z.string()).optional(),
    createTime: z.string().datetime().optional(),
  })
  .openapi("WorldToken");

export const WorldTokenListSchema = z.object({
  tokens: z.array(WorldTokenSchema),
});

export const WorldTokenCreateRequestSchema = z
  .object({
    name: z.string().optional(),
  })
  .openapi("WorldTokenCreateRequest");

export const WorldTokenSingleResponseSchema = z.object({
  token: WorldTokenSchema,
});

export const UsageEventSchema = z
  .object({
    name: z.string(),
    metric: z.string(),
    quantity: z.number().int(),
    unit: z.string(),
    providerCostMicrocents: z.number().int().nullable().optional(),
    wazooMarkupMicrocents: z.number().int().optional(),
    estimatedCostMicrocents: z.number().int().nullable().optional(),
    billingSource: z.string(),
    createTime: z.string().datetime(),
  })
  .openapi("UsageEvent");

export const UsageRecordRequestSchema = z
  .object({
    user: z.string().optional(),
    email: email.optional(),
    metric: nonEmptyString,
    quantity: z.number().int().positive(),
    unit: z.string().optional().default("count"),
    providerCostMicrocents: z.number().int().optional(),
    wazooMarkupMicrocents: z.number().int().optional().default(0),
    estimatedCostMicrocents: z.number().int().optional(),
    billingSource: z.string().optional().default("BETA_FREE"),
    createTime: z.string().datetime().optional(),
  })
  .openapi("UsageRecordRequest");

export const UsageTotalSchema = z.object({
  metric: z.string(),
  quantity: z.number(),
});

export const UsageSummarySchema = z.object({
  usage: z.object({
    world: z.string(),
    total: z.array(UsageTotalSchema),
    events: z.array(UsageEventSchema),
  }),
});

export const UsageAcceptedSchema = z.object({
  accepted: z.boolean(),
});

export const LimitsListSchema = z.object({
  limits: z.array(
    z.object({
      metric: z.string(),
      limitQuantity: z.number(),
    }),
  ),
});

export const BillingSchema = z
  .object({
    world: z.string(),
    state: z.string(),
    provider: z.string(),
    customerConfigured: z.boolean(),
    subscriptionConfigured: z.boolean(),
    paymentRequired: z.boolean(),
  })
  .openapi("Billing");

export const BillingResponseSchema = z.object({
  billing: BillingSchema,
});

export const InvoicesListSchema = z.object({
  invoices: z.array(z.unknown()),
});

export const worldIdParam = z.object({
  worldId: z
    .string()
    .openapi({ param: { name: "worldId", in: "path", required: true } }),
});

export const tokenNameParam = z.object({
  tokenName: z
    .string()
    .openapi({ param: { name: "tokenName", in: "path", required: true } }),
});

export const tokenUidParam = z.object({
  tokenUid: z
    .string()
    .openapi({ param: { name: "tokenUid", in: "path", required: true } }),
});

export const emailQuery = z.object({
  email: email.optional().openapi({
    param: {
      name: "email",
      in: "query",
      description:
        "User email to operate on when using an admin token. User tokens ignore this parameter.",
    },
  }),
});

export const userQuery = z.object({
  user: z
    .string()
    .optional()
    .openapi({
      param: { name: "user", in: "query" },
    }),
});

export const usageRangeQuery = z.object({
  email: email.optional().openapi({
    param: { name: "email", in: "query" },
  }),
  from: z
    .string()
    .optional()
    .openapi({
      param: { name: "from", in: "query" },
    }),
  to: z
    .string()
    .optional()
    .openapi({
      param: { name: "to", in: "query" },
    }),
});
