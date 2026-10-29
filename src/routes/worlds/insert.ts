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
}

export async function insertWorldRow(
  database: Database,
  w: NewWorldRow,
): Promise<void> {
  try {
    await database
      .prepare(
        "INSERT INTO worlds (world_id, user_uid, display_name, region, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(w.worldId, w.userUid, w.displayName, w.region, w.now, w.now)
      .run();
  } catch (error) {
    if (isDuplicateWorldIdError(error)) {
      throw new HTTPException(409, { message: "World ID already exists" });
    }
    throw error;
  }
}
