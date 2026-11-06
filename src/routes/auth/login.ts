import type { OpenAPIHono } from "@hono/zod-openapi";
import { WorkOS } from "@workos-inc/node";
import type { AppEnv } from "../../env";
import { rateLimit } from "../../lib/ratelimit";
import { getApprovedEmails } from "../../lib/beta-allowlist";

export function registerLogin(app: OpenAPIHono<AppEnv>) {
  app.post("/v1/auth/login", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!email) {
      return c.json({ ok: true });
    }

    const ip =
      c.req.header("cf-connecting-ip") ??
      c.req.header("x-forwarded-for") ??
      "unknown";
    if (await rateLimit(c.env, `login:ip:${ip}`, 5, 60_000)) {
      return c.json({ ok: true });
    }

    const sheetId = c.env.BETA_ALLOWLIST_SHEET_ID;
    const key = c.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    let approved: Set<string>;
    try {
      approved = await getApprovedEmails(key ?? "", sheetId);
    } catch (error) {
      // Fail closed: the allowlist could not be read, so nobody is approved.
      // `{ ok: true }` rather than an error keeps this endpoint from becoming
      // an oracle for which emails are on the beta list.
      console.error(
        "[beta-allowlist] could not load allowlist; denying",
        error,
      );
      return c.json({ ok: true });
    }

    if (!approved.has(email)) {
      // Same response as an approved email: a distinct status or body here
      // would let anyone enumerate the beta list. No email is sent.
      return c.json({ ok: true });
    }

    const apiKey = c.env.WORKOS_API_KEY;
    if (!apiKey) {
      return c.json({ ok: true });
    }

    const workos = new WorkOS(apiKey);
    try {
      await workos.userManagement.createMagicAuth({ email });
    } catch {
      return c.json({ ok: true });
    }

    return c.json({ ok: true });
  });
}
