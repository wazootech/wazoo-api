import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { registerCancelWorldSubscription } from "./billing/cancel";
import { registerGetWorldBilling } from "./billing/get";
import { registerListWorldInvoices } from "./billing/invoices";
import { registerOpenBillingPortal } from "./billing/portal";

export { stripeWebhook } from "./billing/webhook";

// Registration order is part of the OpenAPI document's path order; keep it.
export function registerBillingRoutes(app: OpenAPIHono<AppEnv>) {
  registerGetWorldBilling(app);
  registerListWorldInvoices(app);
  registerCancelWorldSubscription(app);
  registerOpenBillingPortal(app);
}
