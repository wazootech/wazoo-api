// Canonical world-id helpers shared by the operational scripts (wazoo-api#149).
import { randomInt } from "node:crypto";
import { MOCK } from "./mode.mjs";

export const WORLD_ID_RE = /^w_[0-7][0-9a-hjkmnp-tv-z]{25}$/;

const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";

// A random, well-formed world ID (w_<lowercase ULID>) that no world holds.
// In mock mode the value is fixed so output stays byte-comparable across runs.
export function randomWorldId() {
  if (MOCK) return "w_01abcdefghjkmnpqrstvwxyz";
  let id = "w_0";
  for (let i = 0; i < 25; i++) id += CROCKFORD[randomInt(32)];
  return id;
}

// Deterministic ids for the mock server (also matches WORLD_ID_RE).
export function sequencedWorldId(n) {
  let suffix = "";
  for (let i = 0; i < 25; i++) suffix += CROCKFORD[n % 32];
  return `w_0${suffix}`;
}
