import type { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../../env";
import { requireScope, respond } from "../../lib/http";
import { createApiKey, deleteApiKey, listApiKeys } from "@worlds/client";
import { WORLD_TOKEN_DEFAULT_SCOPES } from "../../lib/scopes";
import { worldsAdminClient, worldsApiError } from "../../lib/worlds-client";
import {
  createTokenRoute,
  deleteTokenRoute,
  listTokensRoute,
} from "./token-routes";
import { currentUser, notFound, worldForUser } from "./shared";

export function registerWorldTokenRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(listTokensRoute, async (c) => {
    requireScope(c, "worlds.read");
    const query = c.req.valid("query");
    const user = await currentUser(c, query.email, query.email);
    const existing = await worldForUser(c, user.uid, c.req.param("worldId"));
    if (!existing) return notFound(c);
    const res = await listApiKeys({
      client: worldsAdminClient(c.env),
      query: { namespace: user.uid },
    });
    if (res.error)
      throw new HTTPException(502, { message: worldsApiError(res) });
    return respond(c, {
      tokens: (res.data?.keys ?? []).filter(
        (key) => key.worldId === existing.world_id,
      ),
    });
  });

  app.openapi(createTokenRoute, async (c) => {
    requireScope(c, "worlds.write");
    const query = c.req.valid("query");
    const user = await currentUser(c, query.email, query.email);
    const existing = await worldForUser(c, user.uid, c.req.param("worldId"));
    if (!existing) return notFound(c);
    const body = c.req.valid("json");
    // Scope is decided here, at issuance (wazoo-api#21): explicit grants pass
    // through after schema validation (which rejects anything outside
    // WORLD_TOKEN_ALLOWED_SCOPES); an omitted grant falls back to the
    // least-privilege default rather than worlds-api's wider silent default.
    const scopes = body.scopes ?? WORLD_TOKEN_DEFAULT_SCOPES;
    const res = await createApiKey({
      client: worldsAdminClient(c.env),
      body: {
        namespace: user.uid,
        worldId: existing.world_id,
        name: body.name ?? "",
        scopes,
      },
    });
    if (res.error)
      throw new HTTPException(502, { message: worldsApiError(res) });
    return respond(c, { token: res.data }, 201);
  });

  app.openapi(deleteTokenRoute, async (c) => {
    requireScope(c, "worlds.write");
    const query = c.req.valid("query");
    const user = await currentUser(c, query.email, query.email);
    const existing = await worldForUser(c, user.uid, c.req.param("worldId"));
    if (!existing) return notFound(c);
    // Bind the key to the caller's namespace and the path world before the
    // admin-credentialed revoke (memory#69). Not-owned looks like not-found.
    const owned = await listApiKeys({
      client: worldsAdminClient(c.env),
      query: { namespace: user.uid },
    });
    if (owned.error)
      throw new HTTPException(502, { message: worldsApiError(owned) });
    const tokenUid = c.req.param("tokenUid");
    const match = (owned.data?.keys ?? []).find(
      (key) =>
        key.uid === tokenUid &&
        key.namespace === user.uid &&
        key.worldId === existing.world_id,
    );
    if (!match) return notFound(c);
    const res = await deleteApiKey({
      client: worldsAdminClient(c.env),
      path: { keyId: match.uid },
    });
    if (res.error && res.response?.status !== 404)
      throw new HTTPException(502, { message: worldsApiError(res) });
    return c.body(null, 204);
  });
}
