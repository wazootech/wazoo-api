// Shared plumbing for the platform smoke gate test modules (wazoo-api#149).
import { jsonOrNull } from "../lib/http.mjs";

// Same wrapper semantics as before: a thrown error becomes a failed result
// with its message, never an abort.
export async function check(name, fn) {
  try {
    return await fn();
  } catch (err) {
    return { name, passed: false, detail: String(err) };
  }
}

// Aborts the gate before any write when readiness fails.
export async function requireReadiness(context) {
  const targets = [
    { name: "API_BASE_URL", url: `${context.API_BASE_URL}/ready` },
    { name: "WORLDS_API_URL", url: `${context.WORLDS_API_URL}/ready` },
  ];
  for (const { name, url } of targets) {
    const response = await context.http(url);
    const body = await jsonOrNull(response);
    if (response.status !== 200 || body?.status !== "ready") {
      console.error(
        `Smoke run aborted before writes: readiness failed for ${name}`,
      );
      process.exit(1);
    }
  }
}

export { jsonOrNull };
