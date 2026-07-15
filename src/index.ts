import { Hono } from "hono";
import type { AppEnv } from "./env";
import { billing, stripeWebhook } from "./routes/billing";
import { health } from "./routes/health";
import { openapi } from "./routes/openapi";
import { organizations } from "./routes/organizations";
import { tokens } from "./routes/tokens";
import { usage } from "./routes/usage";
import { worlds } from "./routes/worlds";
import { errorHandler, requireAuth } from "./lib/http";

const app = new Hono<AppEnv>();

app.onError(errorHandler);
app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404));

app.route("/", health);
app.route("/", openapi);
app.route("/", stripeWebhook);

const v1 = new Hono<AppEnv>();
v1.use("*", requireAuth);
v1.route("/", organizations);
v1.route("/", worlds);
v1.route("/", tokens);
v1.route("/", usage);
v1.route("/", billing);

app.route("/v1", v1);

export default app;
