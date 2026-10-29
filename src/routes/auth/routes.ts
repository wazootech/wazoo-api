import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../env";
import {
  ErrorResponseSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  VerifyRequestSchema,
  VerifyResponseSchema,
  WorkosSessionRequestSchema,
  WorkosSessionResponseSchema,
} from "../../lib/schemas";

export const jsonError = (description: string) => ({
  description,
  content: { "application/json": { schema: ErrorResponseSchema } },
});

export const loginRoute = createRoute({
  method: "post",
  path: "/v1/auth/login",
  tags: ["Auth"],
  operationId: "login",
  summary: "Start magic-link login",
  description:
    "Sends a one-time code to an allowlisted email. Unauthenticated; limited to 5 requests per minute per IP. Every outcome (missing email, rate-limited, not allowlisted, unconfigured) returns 200 `{ ok: true }` so the endpoint does not reveal which emails are on the beta list; no code is sent to an email that is not allowlisted.",
  "x-mint": { metadata: { title: "Start magic-link login" } },
  security: [],
  request: {
    body: {
      content: { "application/json": { schema: LoginRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Request accepted",
      content: { "application/json": { schema: LoginResponseSchema } },
    },
  },
});

export const verifyRoute = createRoute({
  method: "post",
  path: "/v1/auth/verify",
  tags: ["Auth"],
  operationId: "verifyLogin",
  summary: "Redeem login code for a session token",
  description:
    "Redeems the WorkOS magic-auth code and mints a `wzp_` session token. Unauthenticated; limited to 10 requests per minute per IP.",
  "x-mint": { metadata: { title: "Redeem login code" } },
  security: [],
  request: {
    body: {
      content: { "application/json": { schema: VerifyRequestSchema } },
    },
  },
  responses: {
    201: {
      description: "Session token",
      content: { "application/json": { schema: VerifyResponseSchema } },
    },
    400: jsonError(
      "INVALID_ARGUMENT, INVALID_CODE, EXPIRED, or AGE_GATE_REQUIRED",
    ),
    401: jsonError("Authentication failed"),
    429: jsonError("Too many attempts"),
    500: jsonError("Auth is not configured"),
  },
});

export const workosSessionRoute = createRoute({
  method: "post",
  path: "/v1/auth/workos-session",
  tags: ["Auth"],
  operationId: "createWorkosSession",
  summary: "Mint a console session token (admin)",
  description:
    "Admin-only. Mints a 30-day console session token for an arbitrary email, creating the user when needed. Requires the `admin` scope.",
  "x-mint": { metadata: { title: "Mint console session token" } },
  security: [{ bearerPlatformToken: [] }],
  request: {
    body: {
      content: { "application/json": { schema: WorkosSessionRequestSchema } },
    },
  },
  responses: {
    201: {
      description: "Console session token",
      content: { "application/json": { schema: WorkosSessionResponseSchema } },
    },
    400: jsonError("INVALID_ARGUMENT or AGE_GATE_REQUIRED"),
    401: jsonError("Missing or invalid platform token"),
    403: jsonError("Admin scope required"),
  },
});

// These handlers parse bodies leniently (a malformed body is treated as
// empty) and sit ahead of the /v1/* auth middleware. They are registered
// with plain `app.post` and documented via the registry so that adding the
// OpenAPI metadata cannot change runtime validation behavior.
export function registerAuthDocs(app: OpenAPIHono<AppEnv>) {
  for (const route of [loginRoute, verifyRoute, workosSessionRoute]) {
    app.openAPIRegistry.registerPath(route);
  }
}
