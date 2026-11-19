// QA round trip scenario: the BYOK embeddings acceptance block (worlds-api#1,
// design 6) (wazoo-api#149). Only runs when the acceptance env is set.
// Behavior identical to the pre-split inline code.
export async function setCredential(context) {
  const { call, record, config, state, cleanup } = context;
  // Through the Platform API with the customer's own token, the path a hosted
  // customer has (wazoo-api#123); wazoo-api forwards to worlds-api.
  const cred = await call("PUT", `${config.API}${config.CREDENTIAL_PATH}`, state.tokenA, {
    apiKey: config.PROVIDER_KEY,
  });
  state.hybridReady = record(
    "embeddings: set namespace credential",
    cred.status === 200 && cred.json?.status === "active",
    `status=${cred.json?.status} last4=${cred.json?.last4}`,
    cred,
  );
  cleanup.push(async () => {
    await call("DELETE", `${config.API}${config.CREDENTIAL_PATH}`, state.tokenA);
  });
  const patch = await call("PATCH", `${config.DATA}/worlds/${state.worldId}`, config.DATA_ADMIN, {
    embeddingModel: config.EMBEDDING_MODEL,
  });
  record(
    "embeddings: world embedding model set (stale until reindex)",
    patch.status === 200 &&
      patch.json?.embeddingModel === config.EMBEDDING_MODEL &&
      patch.json?.embeddingStatus === "stale",
    `embeddingModel=${patch.json?.embeddingModel} embeddingStatus=${patch.json?.embeddingStatus}`,
    patch,
  );
}

export async function assertVectorSync(context, reindex) {
  const { record } = context;
  const vs = reindex.json?.vectorSync;
  record(
    "embeddings: reindex synced vectors",
    reindex.status === 200 &&
      reindex.json?.status === "completed" &&
      vs?.enabled === true &&
      vs?.failedUpserts === 0 &&
      vs?.embeddingFailures === 0,
    `status=${reindex.json?.status} vectorSync.enabled=${vs?.enabled} failedUpserts=${vs?.failedUpserts} embeddingFailures=${vs?.embeddingFailures}`,
    reindex,
  );
}

export async function assertCredentialRevoke(context) {
  const { call, record, config, state } = context;
  if (!state.hybridReady) return;
  const rev = await call("DELETE", `${config.API}${config.CREDENTIAL_PATH}`, state.tokenA);
  record(
    "embeddings: revoke credential",
    rev.status === 204,
    "revoked",
    rev,
  );
  // Other isolates may keep the SDK and decrypted key they cached before
  // the revoke for up to 60 s, so wait for the drop to keyword search.
  const started = Date.now();
  let afterRevoke;
  for (;;) {
    afterRevoke = await call(
      "POST",
      `${config.DATA}/worlds/${state.worldId}/search`,
      state.worldToken,
      { query: context.MARKER },
    );
    if (
      afterRevoke.json?.mode === "keyword" ||
      Date.now() - started > 90_000
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  record(
    "embeddings: after revoke search is keyword (200)",
    afterRevoke.status === 200 && afterRevoke.json?.mode === "keyword",
    `mode=${afterRevoke.json?.mode} waited=${Math.round((Date.now() - started) / 1000)}s`,
    afterRevoke,
  );
}
