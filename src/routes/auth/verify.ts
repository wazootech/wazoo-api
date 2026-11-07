import { issueSessionToken } from "./session-token";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../env";
import { findOrCreateUser, redeemCode } from "./verify-helpers";
import { rateLimit } from "../../lib/ratelimit";
import { respond } from "../../lib/http";
import { isApprovedEmail } from "../../lib/beta-allowlist";

export function registerVerify(app: OpenAPIHono<AppEnv>) {
  app.post("/v1/auth/verify", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const ageConfirmed =
      typeof body.ageConfirmed === "boolean" ? body.ageConfirmed : false;

    if (!email || !code) {
      return respond(
        c,
        {
          error: {
            code: "INVALID_ARGUMENT",
            message: "email and code are required",
          },
        },
        400,
      );
    }

    const ip =
      c.req.header("cf-connecting-ip") ??
      c.req.header("x-forwarded-for") ??
      "unknown";
    if (await rateLimit(c.env, `verify:ip:${ip}`, 10, 60_000)) {
      return respond(
        c,
        {
          error: {
            code: "RATE_LIMITED",
            message: "Too many attempts. Please try again later.",
          },
        },
        429,
      );
    }

    const apiKey = c.env.WORKOS_API_KEY;
    const clientId = c.env.WORKOS_CLIENT_ID;
    if (!apiKey || !clientId) {
      return respond(
        c,
        { error: { code: "CONFIG_ERROR", message: "Auth is not configured." } },
        500,
      );
    }

    // Re-check the beta allowlist where the session is minted, not only where
    // the code is issued (memory#68). Same response as a bad code so this is
    // not an oracle for the beta list.
    if (!(await isApprovedEmail(c.env, email))) {
      return respond(
        c,
        {
          error: {
            code: "INVALID_CODE",
            message: "Invalid verification code.",
          },
        },
        400,
      );
    }

    const failed = await redeemCode(c, apiKey, clientId, email, code);
    if (failed) return failed;

    const created = await findOrCreateUser(c, email, ageConfirmed);
    if (created instanceof Response) return created;
    const userUid = created;

    return issueSessionToken(c, userUid);
  });
}
