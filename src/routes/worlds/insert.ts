import { HTTPException } from "hono/http-exception";
import type { Database } from "../../lib/db";

function isDuplicateWorldIdError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /UNIQUE constraint failed: (?:worlds\.world_id|worlds\.user_uid, worlds\.world_id)/i.test(
    message,
  );
}

export interface NewWorldRow {
  worldId: string;
  userUid: string;
  displayName: string;
  region: string;
  now: string;
  /**
   * Per-user cap on non-deleted worlds. When set, the count and the insert are
   * one SQL statement, so concurrent creates cannot both pass a stale count
   * (wazoo-api#150). Omit to insert unconditionally (admin quota bypass).
   */
  maxWorlds?: number;
}

const COLUMNS =
  "world_id, user_uid, display_name, region, create_time, update_time";

/** Inserts the world row; resolves false when the user is already at the cap. */
export async function insertWorldRow(
  database: Database,
  w: NewWorldRow,
): Promise<boolean> {
  const values = [w.worldId, w.userUid, w.displayName, w.region, w.now, w.now];
  const capped = w.maxWorlds !== undefined;
  const sql = capped
    ? `INSERT INTO worlds (${COLUMNS}) SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM worlds WHERE user_uid = ? AND state != 'deleted') < ?`
    : `INSERT INTO worlds (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`;
  const args = capped ? [...values, w.userUid, w.maxWorlds] : values;
  try {
    const { changes } = await database
      .prepare(sql)
      .bind(...args)
      .run();
    return changes > 0;
  } catch (error) {
    if (isDuplicateWorldIdError(error)) {
      throw new HTTPException(409, { message: "World ID already exists" });
    }
    throw error;
  }
}
