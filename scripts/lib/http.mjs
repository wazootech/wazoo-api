// Shared HTTP plumbing for the operational scripts (wazoo-api#149).
import { MOCK } from "./mode.mjs";

export function parseJsonBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function jsonOrNull(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// Tokens recorded here are scrubbed from any redact() output. Nothing
// secret-shaped is ever printed by the scripts.
export class Secrets {
  #values = new Set();

  add(value) {
    if (typeof value === "string" && value.length > 0) this.#values.add(value);
  }

  redact(value) {
    let text = typeof value === "string" ? value : JSON.stringify(value);
    for (const secret of this.#values)
      if (secret) text = text.split(secret).join("[redacted]");
    return text;
  }
}

// Returns a fetch-like function: the real fetch in live mode, or the in-process
// mock router when MOCK. Script code keeps using res.json()/res.text()/res.ok,
// and in mock mode no request ever reaches a network.
export function mockAwareFetch(router) {
  if (!MOCK) return fetch.bind(globalThis);
  return async (input, init = {}) => {
    const handled = await router.handle(input, init);
    const isJson = handled.json !== undefined;
    const body = isJson ? JSON.stringify(handled.json) : (handled.text ?? "");
    return new Response(handled.status === 204 ? null : body, {
      status: handled.status,
      headers: {
        "content-type": isJson ? "application/json" : "text/plain",
      },
    });
  };
}
