import { z } from "@hono/zod-openapi";

/** The worlds-api allowlist of embedding providers. */
export const PROVIDERS = ["openai", "openrouter"] as const;

/** Printable ASCII, no whitespace; mirrors worlds-api so bad keys fail fast. */
export const API_KEY_PATTERN = /^[\x21-\x7e]{16,512}$/;

export const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export const EmbeddingCredentialSchema = z
  .object({
    provider: z.enum(PROVIDERS),
    status: z.enum(["active", "invalid", "revoked"]),
    fingerprint: z.string(),
    last4: z.string(),
    createTime: z.string(),
    rotateTime: z.string().optional(),
    revokeTime: z.string().optional(),
  })
  .openapi("EmbeddingCredential");

export const EmbeddingProviderListSchema = z
  .object({ providers: z.array(EmbeddingCredentialSchema) })
  .openapi("EmbeddingProviderList");

export const providerParam = z.object({
  provider: z.enum(PROVIDERS).openapi({
    param: { name: "provider", in: "path", required: true },
    description:
      "Embedding provider this credential addresses. A user holds at most one credential per provider.",
  }),
});

export const errorContent = { "application/json": { schema: ErrorSchema } };
