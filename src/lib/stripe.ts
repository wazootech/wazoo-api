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

/**
 * DELETEs a Stripe resource (a subscription cancels immediately). Same
 * contract as `stripePost`: never throws, and the message is Stripe's own.
 */
export async function stripeDelete<T>(
  env: Bindings,
  path: string,
): Promise<StripeResult<T>> {
  if (!env.STRIPE_SECRET_KEY) {
    return { ok: false, status: 503, message: "Stripe is not configured" };
  }
  try {
    const res = await fetch(`https://api.stripe.com${path}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
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

export { verifyStripeSignature } from "./stripe-signature";
