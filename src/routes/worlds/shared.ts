import type { Context } from "hono";
import type { AppEnv } from "../../env";
import { db, first, type UserRef } from "../../lib/db";
import { resolveUser, respond } from "../../lib/http";

export interface WorldRow extends Record<string, unknown> {
  user_uid: string;
  world_id: string;
  display_name: string;
  region: string;
  state: string;
  create_time?: string;
  update_time?: string;
  delete_time?: string | null;
  expire_time?: string | null;
}

export function worldResource(row: WorldRow) {
  const restorable =
    row.state === "deleted" &&
    (!row.expire_time || new Date(row.expire_time).getTime() > Date.now());
  return {
    id: row.world_id,
    displayName: row.display_name,
    region: row.region,
    state: row.state.toUpperCase(),
    restorable,
    backend: "worlds-api",
    createTime: row.create_time,
    updateTime: row.update_time,
    deleteTime: row.delete_time ?? undefined,
    expireTime: row.expire_time ?? undefined,
  };
}

export async function currentUser(
  c: Context<AppEnv>,
  ownerEmail?: string,
  email?: string,
): Promise<UserRef> {
  return resolveUser(c, ownerEmail ?? email ?? undefined);
}

export async function worldForUser(
  c: Context<AppEnv>,
  userUid: string,
  worldId: string,
) {
  return first<WorldRow>(
    db(c.env)
      .prepare("SELECT * FROM worlds WHERE user_uid = ? AND world_id = ?")
      .bind(userUid, worldId),
  );
}

export function notFound(c: Context<AppEnv>) {
  return respond(
    c,
    { error: { code: "NOT_FOUND", message: "Not found" } },
    404,
  );
}
