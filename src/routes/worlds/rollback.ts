import { deleteApiKey, deleteWorld } from "@worlds/client";
import type { Bindings } from "../../env";
import { worldsAdminClient } from "../../lib/worlds-client";

/**
 * Best-effort undo of worlds-api provisioning when the quota-guarded insert
 * rejects the row (wazoo-api#150). Failures are logged, never thrown: the
 * caller still answers 429, and an orphan is reconcilable by world id.
 */
export async function rollbackProvisioning(
  env: Bindings,
  worldId: string,
  keyUid: string | undefined,
): Promise<void> {
  const client = worldsAdminClient(env);
  try {
    const res = await deleteWorld({ client, path: { worldId } });
    if (res.error && res.response?.status !== 404) {
      console.warn("quota rollback: world delete failed", { worldId });
    }
    if (keyUid) await deleteApiKey({ client, path: { keyId: keyUid } });
  } catch (error) {
    console.warn("quota rollback failed", { worldId, error: String(error) });
  }
}
