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
