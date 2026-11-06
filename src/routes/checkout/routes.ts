import { createRoute } from "@hono/zod-openapi";
import { SessionUrlSchema, ErrorSchema } from "./shared";

export const checkoutRoute = createRoute({
  method: "post",
  path: "/v1/users/me/billing/checkout",
  tags: ["Billing"],
  operationId: "createCheckoutSession",
  summary: "Start a Pro subscription checkout",
  description:
    "Creates a Stripe Checkout session for the Pro plan and returns the hosted page's URL. The plan changes when Stripe confirms the payment (a webhook), not when this call returns, so the console shows the new plan shortly after the user comes back.",
  "x-mint": { metadata: { title: "Start a Pro checkout" } },
  security: [{ bearerPlatformToken: [] }],
  responses: {
    200: {
      description: "Checkout session created",
      content: { "application/json": { schema: SessionUrlSchema } },
    },
    409: {
      description: "The user already has a subscription (ALREADY_SUBSCRIBED).",
      content: { "application/json": { schema: ErrorSchema } },
    },
    502: {
      description: "Stripe refused the request (STRIPE_ERROR).",
      content: { "application/json": { schema: ErrorSchema } },
    },
    503: {
      description: "Billing is not configured (BILLING_NOT_CONFIGURED).",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

export const portalRoute = createRoute({
  method: "post",
  path: "/v1/users/me/billing/portal",
  tags: ["Billing"],
  operationId: "createBillingPortalSession",
  summary: "Open the Stripe billing portal",
  description:
    "Creates a Stripe billing portal session where the user can update their card, see invoices or cancel, and returns its URL.",
  "x-mint": { metadata: { title: "Open the billing portal" } },
  security: [{ bearerPlatformToken: [] }],
  responses: {
    200: {
      description: "Portal session created",
      content: { "application/json": { schema: SessionUrlSchema } },
    },
    409: {
      description: "The user has no billing account yet (NO_BILLING_ACCOUNT).",
      content: { "application/json": { schema: ErrorSchema } },
    },
    502: {
      description: "Stripe refused the request (STRIPE_ERROR).",
      content: { "application/json": { schema: ErrorSchema } },
    },
    503: {
      description: "Billing is not configured (BILLING_NOT_CONFIGURED).",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});
