import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { registerListLimits } from "./usage/limits";
import { registerRecordUsage } from "./usage/record";
import { registerUsageSummary } from "./usage/summary";

// Registration order is part of the OpenAPI document's path order; keep it.
export function registerUsageRoutes(app: OpenAPIHono<AppEnv>) {
  registerUsageSummary(app);
  registerRecordUsage(app);
  registerListLimits(app);
}
