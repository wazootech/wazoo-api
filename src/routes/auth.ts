import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { registerLogin } from "./auth/login";
import { registerAuthDocs } from "./auth/routes";
import { registerVerify } from "./auth/verify";
import { registerWorkos } from "./auth/workos";

export function registerAuthRoutes(app: OpenAPIHono<AppEnv>) {
  registerAuthDocs(app);
  registerWorkos(app);
  registerLogin(app);
  registerVerify(app);
}
