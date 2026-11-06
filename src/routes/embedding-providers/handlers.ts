import type { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";
import type { AppEnv } from "../../env";
import { isAdmin, requireScope, respond } from "@/lib/http";
import { worldsApiBase } from "@/lib/worlds-client";
import { API_KEY_PATTERN } from "./schemas";
import { listRoute, putRoute, getRoute, deleteRoute } from "./routes";

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
