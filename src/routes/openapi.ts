import { Hono } from "hono";
import type { AppEnv } from "../env";

const routes = [
  "GET /health",
  "GET /openapi.json",
  "GET /v1/organizations",
  "POST /v1/organizations",
  "GET /v1/organizations/:organizationId",
  "PATCH /v1/organizations/:organizationId",
  "GET /v1/organizations/:organizationId/worlds",
  "POST /v1/organizations/:organizationId/worlds",
  "GET /v1/organizations/:organizationId/worlds/:worldId",
  "PATCH /v1/organizations/:organizationId/worlds/:worldId",
  "DELETE /v1/organizations/:organizationId/worlds/:worldId",
  "GET /v1/organizations/:organizationId/worlds/:worldId/auth/tokens",
  "POST /v1/organizations/:organizationId/worlds/:worldId/auth/tokens",
  "POST /v1/organizations/:organizationId/worlds/:worldId/auth/rotate",
  "DELETE /v1/organizations/:organizationId/worlds/:worldId/auth/tokens/:tokenId",
  "GET /v1/auth/api-tokens",
  "POST /v1/auth/api-tokens/:tokenName",
  "DELETE /v1/auth/api-tokens/:tokenName",
  "GET /v1/auth/api-tokens/validate",
  "GET /v1/organizations/:organizationId/platform-tokens",
  "POST /v1/organizations/:organizationId/platform-tokens",
  "DELETE /v1/organizations/:organizationId/platform-tokens/:tokenId",
  "GET /v1/organizations/:organizationId/usage",
  "POST /v1/organizations/:organizationId/usage",
  "GET /v1/organizations/:organizationId/billing",
  "GET /v1/organizations/:organizationId/billing/invoices",
  "POST /v1/organizations/:organizationId/billing:openPortal",
  "POST /v1/stripe/webhook"
];

export const openapi = new Hono<AppEnv>().get("/openapi.json", (c) => {
  return c.json({
    openapi: "3.1.0-ish",
    info: { title: "Wazoo Platform API", version: "0.1.0" },
    security: [{ bearerPlatformToken: [] }],
    routes
  });
});
