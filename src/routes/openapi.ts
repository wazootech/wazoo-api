import { Hono } from "hono";
import type { AppEnv } from "../env";

const routes = [
  "GET /health",
  "GET /openapi.json",
  "GET /v1/users/me",
  "GET /v1/worlds",
  "POST /v1/worlds",
  "GET /v1/worlds/:worldId",
  "PATCH /v1/worlds/:worldId",
  "DELETE /v1/worlds/:worldId",
  "POST /v1/worlds/:worldId/undelete",
  "POST /v1/worlds/:worldId/sync",
  "GET /v1/worlds/:worldId/auth/tokens",
  "POST /v1/worlds/:worldId/auth/tokens",
  "DELETE /v1/worlds/:worldId/auth/tokens/:tokenUid",
  "GET /v1/auth/api-tokens",
  "POST /v1/auth/api-tokens",
  "DELETE /v1/auth/api-tokens/:tokenName",
  "GET /v1/auth/api-tokens/validate",
  "GET /v1/worlds/:worldId/usage",
  "GET /v1/worlds/:worldId/limits",
  "POST /v1/worlds/:worldId/usage",
  "GET /v1/worlds/:worldId/billing",
  "GET /v1/worlds/:worldId/billing/invoices",
  "POST /v1/worlds/:worldId/billing/openPortal",
  "POST /v1/stripe/webhook",
];

export const openapi = new Hono<AppEnv>().get("/openapi.json", (c) => {
  return c.json({
    openapi: "3.1.0-ish",
    info: { title: "Wazoo Platform API", version: "0.1.0" },
    security: [{ bearerPlatformToken: [] }],
    routes,
  });
});
