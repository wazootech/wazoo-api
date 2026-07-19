import { serve } from "@hono/node-server";
import app from "./index";

const port = Number(process.env.PORT) || 8080;
console.log(`wazoo-api listening on :${port}`);
serve({ fetch: app.fetch, port });
