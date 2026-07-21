import type { Bindings } from "../env";
import { db } from "./db";

export async function rateLimit(
  env: Bindings,
  key: string,
  max: number,
  windowMs: number,
): Promise<boolean> {
  const database = db(env);
  const now = Date.now();
  const resetAt = now + windowMs;

  const row = await database
    .prepare(
      `INSERT INTO rate_limit_entries (key, count, reset_at_ms)
       VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN reset_at_ms < ? THEN 1 ELSE count + 1 END,
         reset_at_ms = CASE WHEN reset_at_ms < ? THEN ? ELSE reset_at_ms END
       RETURNING count`,
    )
    .bind(key, resetAt, now, now, resetAt)
    .first<{ count: number }>();

  if (!row) return false;
  return row.count > max;
}
