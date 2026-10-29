import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { registerLogin } from "./auth/login";
import { registerAuthDocs } from "./auth/routes";
import { registerVerify } from "./auth/verify";
import { registerWorkosSession } from "./auth/workos-session";

export function registerAuthRoutes(app: OpenAPIHono<AppEnv>) {
  registerAuthDocs(app);
  registerWorkosSession(app);
  registerLogin(app);
  registerVerify(app);
}
