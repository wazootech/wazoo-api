import { existsSync, readFileSync } from "fs";
import { serve } from "@hono/node-server";
import { bindingsFromProcessEnv } from "./env";
import app from "./index";

if (existsSync(".dev.vars")) {
  for (const line of readFileSync(".dev.vars", "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

const port = Number(process.env.PORT) || 8080;
const env = bindingsFromProcessEnv();
console.log(`wazoo-api listening on :${port}`);
serve({
  fetch: (req) => app.fetch(req, env),
  port,
});
