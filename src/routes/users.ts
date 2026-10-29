import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { registerConfirmDeletion } from "./users/confirm-deletion";
import { registerExportUser } from "./users/export";
import { registerInitiateDeletion } from "./users/initiate-deletion";
import { registerUpsertUser } from "./users/upsert";

// Registration order is part of the OpenAPI document's path order; keep it.
export function registerUsersRoutes(app: OpenAPIHono<AppEnv>) {
  registerUpsertUser(app);
  registerInitiateDeletion(app);
  registerConfirmDeletion(app);
  registerExportUser(app);
}
