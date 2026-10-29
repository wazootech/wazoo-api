import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { registerCreateWorld } from "./worlds/create";
import { registerDeleteWorld } from "./worlds/delete";
import { registerGetWorld, registerListWorlds } from "./worlds/read";
import { registerWorldTokenRoutes } from "./worlds/tokens";
import { registerUndeleteWorld } from "./worlds/undelete";
import { registerUpdateWorld } from "./worlds/update";

// Registration order is part of the OpenAPI document's path order; keep it.
export function registerWorldsRoutes(app: OpenAPIHono<AppEnv>) {
  registerListWorlds(app);
  registerCreateWorld(app);
  registerGetWorld(app);
  registerUpdateWorld(app);
  registerDeleteWorld(app);
  registerUndeleteWorld(app);
  registerWorldTokenRoutes(app);
}
