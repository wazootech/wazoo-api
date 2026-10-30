import { createRoute, z } from "@hono/zod-openapi";
import {
  EmbeddingCredentialSchema,
  EmbeddingProviderListSchema,
  providerParam,
  errorContent,
} from "./schemas";

export const listRoute = createRoute({
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

export const putRoute = createRoute({
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

export const getRoute = createRoute({
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

export const deleteRoute = createRoute({
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
