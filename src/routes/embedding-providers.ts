import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";
import type { AppEnv } from "../env";
import { isAdmin, requireScope, respond } from "@/lib/http";
import { worldsApiBase } from "@/lib/worlds-client";

/** The worlds-api allowlist of embedding providers. */
const PROVIDERS = ["openai", "openrouter"] as const;

/** Printable ASCII, no whitespace; mirrors worlds-api so bad keys fail fast. */
const API_KEY_PATTERN = /^[\x21-\x7e]{16,512}$/;

const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const EmbeddingCredentialSchema = z
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

const EmbeddingProviderListSchema = z
  .object({ providers: z.array(EmbeddingCredentialSchema) })
  .openapi("EmbeddingProviderList");

const providerParam = z.object({
  provider: z.enum(PROVIDERS).openapi({
    param: { name: "provider", in: "path", required: true },
    description:
      "Embedding provider this credential addresses. A user holds at most one credential per provider.",
  }),
});

const errorContent = { "application/json": { schema: ErrorSchema } };

const listRoute = createRoute({
  method: "get",
  path: "/v1/users/me/embedding-providers",
  tags: ["Embeddings"],
  operationId: "listEmbeddingProviders",
  summary: "List embedding provider credentials",
  description:
    "Lists the caller's bring-your-own-key embedding credentials, revoked ones included so their status stays readable. Metadata only: a key is never returned.",
  "x-mint": { metadata: { title: "List embedding provider credentials" } },
  security: [{ bearerPlatformToken: [] }],
  responses: {
    200: {
      description: "Credential metadata, one entry per provider",
      content: { "application/json": { schema: EmbeddingProviderListSchema } },
    },
    401: { description: "Not authenticated as a user", content: errorContent },
    403: { description: "Missing scope", content: errorContent },
  },
});

const putRoute = createRoute({
  method: "put",
  path: "/v1/users/me/embedding-providers/{provider}",
  tags: ["Embeddings"],
  operationId: "setEmbeddingProviderCredential",
  summary: "Set an embedding provider credential",
  description:
    "Stores or rotates the caller's API key for one embedding provider. The key is encrypted at rest, write-only, and never returned or logged. Choose a model, reindex, and search with a world token on the data plane afterwards. Returns 503 EMBEDDINGS_NOT_CONFIGURED when the deployment has embeddings disabled.",
  "x-mint": { metadata: { title: "Set an embedding provider credential" } },
  security: [{ bearerPlatformToken: [] }],
  request: {
    params: providerParam,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            apiKey: z.string().openapi({
              description:
                "The provider API key: 16 to 512 printable characters with no whitespace.",
            }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Credential stored; metadata only",
      content: { "application/json": { schema: EmbeddingCredentialSchema } },
    },
    400: { description: "Bad request", content: errorContent },
    401: { description: "Not authenticated as a user", content: errorContent },
    403: { description: "Missing scope", content: errorContent },
    503: {
      description: "Embeddings are not configured on this deployment",
      content: errorContent,
    },
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/v1/users/me/embedding-providers/{provider}",
  tags: ["Embeddings"],
  operationId: "getEmbeddingProviderCredential",
  summary: "Get an embedding provider credential's status",
  description:
    "Returns the metadata of the caller's credential for one provider. The key itself is never returned.",
  "x-mint": { metadata: { title: "Get an embedding provider credential" } },
  security: [{ bearerPlatformToken: [] }],
  request: { params: providerParam },
  responses: {
    200: {
      description: "Credential metadata",
      content: { "application/json": { schema: EmbeddingCredentialSchema } },
    },
    401: { description: "Not authenticated as a user", content: errorContent },
    403: { description: "Missing scope", content: errorContent },
    404: { description: "No credential", content: errorContent },
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/v1/users/me/embedding-providers/{provider}",
  tags: ["Embeddings"],
  operationId: "deleteEmbeddingProviderCredential",
  summary: "Revoke an embedding provider credential",
  description:
    "Revokes the caller's credential for one provider. The stored key is erased and every world on that provider's models falls back to keyword search until a new key is stored and the world is reindexed. Worlds on another provider's models are not affected.",
  "x-mint": { metadata: { title: "Revoke an embedding provider credential" } },
  security: [{ bearerPlatformToken: [] }],
  request: { params: providerParam },
  responses: {
    204: { description: "Revoked" },
    401: { description: "Not authenticated as a user", content: errorContent },
    403: { description: "Missing scope", content: errorContent },
    404: { description: "No credential", content: errorContent },
  },
});

/** The caller's own namespace, which is their user uid. Admin tokens have none. */
function callerNamespace(c: Context<AppEnv>): string {
  const auth = c.get("auth");
  if (isAdmin(c) || !auth.userUid) {
    throw new HTTPException(401, {
      message: "Embedding credentials require a user token",
    });
  }
  return auth.userUid;
}

/**
 * Forwards to worlds-api with the service admin key. The customer's token is
 * never sent upstream, and the namespace comes from the token, never the path
 * or body. Responses pass through unchanged.
 */
async function forward(
  c: Context<AppEnv>,
  namespace: string,
  suffix: string,
  init: { method: string; body?: unknown },
): Promise<Response> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${c.env.WORLDS_API_ADMIN_KEY}`,
  };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(
    `${worldsApiBase(c.env)}/namespaces/${encodeURIComponent(namespace)}/embedding-providers${suffix}`,
    {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    },
  );
  if (res.status === 204) return c.body(null, 204);
  return new Response(res.body, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}

export function registerEmbeddingProviderRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(listRoute, async (c) => {
    requireScope(c, "users.read");
    return (await forward(c, callerNamespace(c), "", {
      method: "GET",
    })) as never;
  });

  app.openapi(putRoute, async (c) => {
    requireScope(c, "users.write");
    const namespace = callerNamespace(c);
    const { provider } = c.req.valid("param");
    const { apiKey } = c.req.valid("json");
    if (!API_KEY_PATTERN.test(apiKey)) {
      return respond(
        c,
        {
          error: {
            code: "INVALID_ARGUMENT",
            message:
              "apiKey must be 16-512 printable characters with no whitespace",
          },
        },
        400,
      );
    }
    return (await forward(c, namespace, `/${provider}`, {
      method: "PUT",
      body: { apiKey },
    })) as never;
  });

  app.openapi(getRoute, async (c) => {
    requireScope(c, "users.read");
    const { provider } = c.req.valid("param");
    return (await forward(c, callerNamespace(c), `/${provider}`, {
      method: "GET",
    })) as never;
  });

  app.openapi(deleteRoute, async (c) => {
    requireScope(c, "users.write");
    const { provider } = c.req.valid("param");
    return (await forward(c, callerNamespace(c), `/${provider}`, {
      method: "DELETE",
    })) as never;
  });
}
