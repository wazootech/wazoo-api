interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const ipLimits = new Map<string, RateLimitEntry>();
const emailLimits = new Map<string, RateLimitEntry>();

const EMAIL_WINDOW_MS = 5 * 60 * 1000;
const EMAIL_MAX = 5;
const IP_WINDOW_MS = 60 * 1000;
const IP_MAX = 3;

export function rateLimitIp(ip: string): boolean {
  return checkLimit(ipLimits, ip, IP_MAX, IP_WINDOW_MS);
}

export function rateLimitEmail(email: string, kind: string): boolean {
  const key = `${kind}:${email.toLowerCase()}`;
  return checkLimit(emailLimits, key, EMAIL_MAX, EMAIL_WINDOW_MS);
}

function checkLimit(
  store: Map<string, RateLimitEntry>,
  key: string,
  max: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  let entry = store.get(key);
  if (!entry || entry.resetAt < now) {
    entry = { count: 1, resetAt: now + windowMs };
    store.set(key, entry);
    return false;
  }
  entry.count++;
  return entry.count > max;
}

export function cleanExpiredLimits(): void {
  const now = Date.now();
  for (const [key, entry] of ipLimits) {
    if (entry.resetAt < now) ipLimits.delete(key);
  }
  for (const [key, entry] of emailLimits) {
    if (entry.resetAt < now) emailLimits.delete(key);
  }
}
