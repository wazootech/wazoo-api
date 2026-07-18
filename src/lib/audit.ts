import type { Context } from "hono";
import type { AppEnv } from "../env";
import { db, id } from "./db";

export async function recordAdminAudit(
  c: Context<AppEnv>,
  input: {
    action: string;
    targetResourceName: string;
    outcome?: "SUCCESS" | "FAILED" | "BLOCKED";
    errorCode?: string | null;
  },
) {
  await db(c.env)
    .prepare(
      "INSERT INTO admin_audit_events (uid, actor_token_uid, action, target_resource_name, outcome, error_code) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(
      id(),
      c.get("auth").tokenId,
      input.action,
      input.targetResourceName,
      input.outcome ?? "SUCCESS",
      input.errorCode ?? null,
    )
    .run();
}
