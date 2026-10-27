import type { Bindings } from "../env";

/**
 * Minimal Stripe client over fetch (the Worker has no SDK). Params are
 * form-encoded the way Stripe expects, with nested keys as `a[b][0][c]`.
 */
export function encodeStripeParams(
  params: Record<string, unknown>,
  prefix = "",
): string[] {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item !== null && typeof item === "object") {
          pairs.push(
            ...encodeStripeParams(
              item as Record<string, unknown>,
              `${name}[${index}]`,
            ),
          );
        } else {
          pairs.push(
            `${encodeURIComponent(`${name}[${index}]`)}=${encodeURIComponent(String(item))}`,
          );
        }
      });
    } else if (typeof value === "object") {
      pairs.push(...encodeStripeParams(value as Record<string, unknown>, name));
    } else {
      pairs.push(
        `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`,
      );
    }
  }
  return pairs;
}

export type StripeResult<T> =
  { ok: true; data: T } | { ok: false; status: number; message: string };

/**
 * POSTs to the Stripe API with the secret key. Never throws; the failure
 * message is Stripe's own error message, which carries no secrets.
 */
export async function stripePost<T>(
  env: Bindings,
  path: string,
  params: Record<string, unknown>,
): Promise<StripeResult<T>> {
  if (!env.STRIPE_SECRET_KEY) {
    return { ok: false, status: 503, message: "Stripe is not configured" };
  }
  try {
    const res = await fetch(`https://api.stripe.com${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: encodeStripeParams(params).join("&"),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    } & T;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message: body.error?.message ?? `Stripe returned ${res.status}`,
      };
    }
    return { ok: true, data: body };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      message: error instanceof Error ? error.message : "Stripe is unreachable",
    };
  }
}

const SIGNATURE_TOLERANCE_SECONDS = 300;

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Verifies a `Stripe-Signature` header: HMAC-SHA256 of `${t}.${body}` with the
 * endpoint secret, any `v1` signature may match, the timestamp must be within
 * five minutes (replay window), and the comparison is constant-time.
 */
export async function verifyStripeSignature(
  body: string,
  header: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const parts = header.split(",").map((part) => part.trim());
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
  const signatures = parts
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));
  if (!timestamp || signatures.length === 0) return false;
  const t = Number(timestamp);
  if (
    !Number.isInteger(t) ||
    Math.abs(nowSeconds - t) > SIGNATURE_TOLERANCE_SECONDS
  ) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const data = new TextEncoder().encode(`${timestamp}.${body}`);
  for (const signature of signatures) {
    const bytes = hexToBytes(signature);
    if (bytes && (await crypto.subtle.verify("HMAC", key, bytes, data))) {
      return true;
    }
  }
  return false;
}
