import { isAdmin } from "@/lib/http";
import type { Context } from "hono";
import type { AppEnv } from "../../env";
import { HTTPException } from "hono/http-exception";

export const DELETION_TOKEN_TTL_MS = 15 * 60 * 1000;

export interface UserRow extends Record<string, unknown> {
  uid: string;
  email: string;
  display_name: string | null;
  state: string;
  create_time: string;
}

export function userResource(row: UserRow) {
  return {
    uid: row.uid,
    email: row.email,
    displayName: row.display_name,
    state: "ACTIVE",
    createTime: row.create_time,
  };
}

/** Ensures the token belongs to a user (not an env/admin token) and returns it. */
export function requireUserToken(c: Context<AppEnv>): { userUid: string } {
  const auth = c.get("auth");
  if (isAdmin(c) || !auth.userUid) {
    throw new HTTPException(401, {
      message: "Account deletion and data export require a user token",
    });
  }
  return { userUid: auth.userUid };
}
