// QA world-identity round trip (wazoo-api#72; #63 criterion 6).
// Run: infisical run --env=qa --path=/ --path=/ci -- pnpm run roundtrip:qa [evidence.json]
// QA hosts only; never prints token values. Writes evidence JSON to argv[2].
// WAZOO_SCRIPT_MODE=mock (or --dry-run) runs the whole flow against the
// in-process mock server: no network, no credentials (wazoo-api#149).
//
// Driver only; the scenario steps live in scripts/qa-roundtrip/*.mjs, the
// shared helpers in scripts/lib/.
import { loadConfig } from "./qa-roundtrip/config.mjs";
import { createContext } from "./qa-roundtrip/context.mjs";
import {
  checkReadiness,
  mintPlatformToken,
  pushTokenCleanup,
} from "./qa-roundtrip/steps-identity.mjs";
import {
  createWorldAsA,
  readWorld,
  listWorld,
  issueWorldToken,
  importAndVerify,
  reindex,
} from "./qa-roundtrip/steps-world.mjs";
import {
  setCredential,
  assertVectorSync,
  assertCredentialRevoke,
} from "./qa-roundtrip/steps-hybrid.mjs";
import { assertSearch } from "./qa-roundtrip/steps-search.mjs";
import {
  assertCrossUserDenied,
  assertBWorldCrossData,
  assertVectorIsolation,
  assertGhostRead,
  deleteAndVerify,
} from "./qa-roundtrip/steps-denial.mjs";

const config = loadConfig();
const evidencePath = process.argv.filter((arg) => arg !== "--dry-run")[2];
const context = createContext(config);
const { record, state, cleanup } = context;

try {
  await checkReadiness(context);

  const a = await mintPlatformToken(context, context.emailA, "a");
  state.tokenA = a.token;
  const b = await mintPlatformToken(context, context.emailB, "b");
  state.tokenB = b.token;
  pushTokenCleanup(context);

  await createWorldAsA(context);
  await readWorld(context);
  if (config.HYBRID) await setCredential(context);
  await listWorld(context);
  await issueWorldToken(context);
  await importAndVerify(context);
  const reindexed = await reindex(context);
  if (config.HYBRID) await assertVectorSync(context, reindexed);
  await assertSearch(context);
  await assertCrossUserDenied(context);
  await assertBWorldCrossData(context);
  if (config.HYBRID) await assertVectorIsolation(context);
  if (config.HYBRID) await assertCredentialRevoke(context);
  await assertGhostRead(context);
  await deleteAndVerify(context);
} catch (error) {
  record("unexpected error", false, String(error));
} finally {
  for (const step of cleanup.reverse()) {
    try {
      await step();
    } catch (error) {
      record("cleanup error", false, String(error));
    }
  }
  process.exit(context.evidence.finish(evidencePath));
}
