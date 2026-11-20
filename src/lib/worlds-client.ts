import { createClient } from "@worlds/client";
import type { AppEnv } from "../env";

/** worldsApiBase returns the worlds-api base URL without a trailing slash. */
export function worldsApiBase(env: AppEnv["Bindings"]): string {
  return env.WORLDS_API_URL.replace(/\/+$/, "");
}

/**
 * worldsAdminClient returns a `@worlds/client` instance configured for the
 * worlds-api admin surface, authenticated with the service admin key.
 */
export function worldsAdminClient(env: AppEnv["Bindings"]) {
  return createClient({
    baseUrl: worldsApiBase(env),
    auth: env.WORLDS_API_ADMIN_KEY,
  });
}

/**
 * worldsApiErrorDetail extracts `{ code, message }` from a worlds-api client
 * result, mirroring the error-body contract used across worlds-api routes
 * (`{ error: { code, message } }`). Falls back to a status-derived code and
 * message when the payload is missing or unparseable.
 */
export function worldsApiErrorDetail(result: {
  error?: unknown;
  response?: Response;
}): { code: string; message: string } {
  const status = result.response?.status;
  const defaultCode = `WORLDS_API_${status ?? "ERR"}`;
  const defaultMessage = `worlds-api returned ${status ?? "an error"}`;
  const body = result.error as
    | { error?: { code?: string; message?: string } | string; message?: string }
    | undefined;
  if (body && typeof body === "object") {
    const inner = body.error;
    if (typeof inner === "string") {
      return { code: defaultCode, message: inner };
    }
    if (inner && typeof inner === "object") {
      return {
        code: typeof inner.code === "string" ? inner.code : defaultCode,
        message:
          typeof inner.message === "string" ? inner.message : defaultMessage,
      };
    }
    if (typeof body.message === "string") {
      return { code: defaultCode, message: body.message };
    }
  }
  return { code: defaultCode, message: defaultMessage };
}

/** worldsApiError returns only the message from a worlds-api client result. */
export function worldsApiError(result: {
  error?: unknown;
  response?: Response;
}): string {
  return worldsApiErrorDetail(result).message;
}

/**
 * pauseWorld calls worlds-api's POST /worlds/{worldId}/pause (a time-limited,
 * self-service suspension) with the service admin key. Typed like the
 * generated @worlds/client results so worldsApiErrorDetail applies. A
 * dedicated fetch keeps this independent of the generated client until
 * wazoo-client-ts regenerates for the pause endpoint.
 */
export async function pauseWorld(
  env: AppEnv["Bindings"],
  worldId: string,
  durationSeconds: number,
): Promise<{ error?: unknown; response?: Response; data?: unknown }> {
  const response = await fetch(
    `${worldsApiBase(env)}/worlds/${worldId}/pause`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.WORLDS_API_ADMIN_KEY}`,
      },
      body: JSON.stringify({ durationSeconds }),
    },
  );
  if (!response.ok) {
    let error: unknown;
    try {
      error = await response.json();
    } catch {
      error = undefined;
    }
    return { error, response };
  }
  return { data: await response.json().catch(() => undefined), response };
}
