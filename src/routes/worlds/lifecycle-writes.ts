import type { AppEnv } from "../../env";
import { resumeWorld } from "@worlds/client";
import {
  pauseWorld,
  worldsAdminClient,
  worldsApiError,
} from "../../lib/worlds-client";

export const PAUSE_DURATION_BOUNDS = { min: 60, max: 30 * 24 * 60 * 60 };

/** nextState from a PATCH updateMask/world pair, or null when state is untouched. */
export function nextStateOf(
  updateMask: string[],
  patch: { state?: string },
): "ACTIVE" | "SUSPENDED" | null {
  if (!updateMask.includes("state")) return null;
  const nextState = patch.state?.toUpperCase() ?? null;
  return nextState === "ACTIVE" || nextState === "SUSPENDED" ? nextState : null;
}

/**
 * Validates a PATCH state transition (wazoo-api#22): state is limited to
 * ACTIVE/SUSPENDED, and SUSPENDED is the self-service pause class, so it must
 * carry a mandatory time limit. Indefinite suspension stays control-plane
 * only and is never accepted here. Returns the rejection message or null.
 */
export function statePatchError(
  patch: { pauseDurationSeconds?: number },
  nextState: "ACTIVE" | "SUSPENDED" | null,
): string | null {
  if (nextState === null) return null;
  if (nextState === "SUSPENDED") {
    const duration = patch.pauseDurationSeconds;
    if (
      !Number.isInteger(duration) ||
      duration === undefined ||
      duration < PAUSE_DURATION_BOUNDS.min ||
      duration > PAUSE_DURATION_BOUNDS.max
    ) {
      return "pausing requires pauseDurationSeconds between 60 and 2592000";
    }
  }
  return null;
}

export type LifecycleFailure = {
  status: 502;
  body: { error: { code: "WORLD_UPDATE_FAILED"; message: string } };
};

function failure(message: string): LifecycleFailure {
  return {
    status: 502,
    body: { error: { code: "WORLD_UPDATE_FAILED", message } },
  };
}

/**
 * Awaited worlds-api lifecycle writes for PATCH state (wazoo-api#22). The
 * local row only moves after worlds-api confirms, so a failure here is a 502
 * and never a one-sided success.
 */

/** Pauses the world in worlds-api with a mandatory time limit. */
export async function pauseWorldConfirmed(
  env: AppEnv["Bindings"],
  worldId: string,
  durationSeconds: number,
): Promise<LifecycleFailure | null> {
  const res = await pauseWorld(env, worldId, durationSeconds);
  if (res.error) return failure(worldsApiError(res));
  return null;
}

/** Resumes the world in worlds-api. */
export async function resumeWorldConfirmed(
  env: AppEnv["Bindings"],
  worldId: string,
): Promise<LifecycleFailure | null> {
  const res = await resumeWorld({
    client: worldsAdminClient(env),
    path: { worldId },
  });
  if (res.error) return failure(worldsApiError(res));
  return null;
}
