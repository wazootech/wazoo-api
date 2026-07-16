import { HTTPException } from "hono/http-exception";
import type { Bindings } from "../env";

type TurnstileResponse = { success?: boolean; "error-codes"?: string[] };

export async function verifyTurnstile(env: Bindings, token: string, remoteIp?: string) {
  if (!env.TURNSTILE_SECRET_KEY) {
    throw new HTTPException(500, { message: "Turnstile is not configured" });
  }

  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET_KEY);
  form.set("response", token);
  if (remoteIp) form.set("remoteip", remoteIp);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const result = await response.json<TurnstileResponse>();
  if (!result.success) {
    throw new HTTPException(400, { message: `Turnstile verification failed${result["error-codes"]?.length ? `: ${result["error-codes"].join(", ")}` : ""}` });
  }
}
