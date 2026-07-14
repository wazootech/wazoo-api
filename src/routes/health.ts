import { Hono } from "hono";
import type { AppEnv } from "../env";

export const health = new Hono<AppEnv>().get("/health", (c) => {
  return c.json({ status: "ok" });
});
