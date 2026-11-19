// QA round trip scenario: cross-user denial checks, the ghost-ID probe, and
// the final delete (wazoo-api#149). Behavior identical to the pre-split code.

export async function assertCrossUserDenied(context) {
  const { call, record, config, state } = context;
  // Cross-user denial: B holds a valid w_<ULID> that belongs to A.
  const bRead = await call("GET", `${config.API}/v1/worlds/${state.worldId}`, state.tokenB);
  record(
    "cross-user read denied (B -> A's world)",
    bRead.status === 404 || bRead.status === 403,
    "owner predicate refuses a valid foreign ID",
    bRead,
  );
  const bList = await call("GET", `${config.API}/v1/worlds`, state.tokenB);
  record(
    "cross-user list excludes A's world",
    bList.status === 200 &&
      !(bList.json?.worlds ?? []).some((world) => world.id === state.worldId),
    "not visible to B", bList,
  );
  const bToken = await call(
    "POST",
    `${config.API}/v1/worlds/${state.worldId}/auth/tokens`,
    state.tokenB,
    { name: `${context.run}-steal` },
  );
  record(
    "cross-user world-token mint denied",
    bToken.status === 404 || bToken.status === 403,
    "B cannot mint a token for A's world",
    bToken,
  );
  const bDelete = await call("DELETE", `${config.API}/v1/worlds/${state.worldId}`, state.tokenB);
  record(
    "cross-user delete denied",
    bDelete.status === 404 || bDelete.status === 403,
    "B cannot delete A's world",
    bDelete,
  );
}

export async function assertBWorldCrossData(context) {
  const { call, record, config, evidence, state } = context;
  // B's own world token must not reach A's data plane.
  const bCreate = await call("POST", `${config.API}/v1/worlds`, state.tokenB, {
    displayName: `Round trip ${context.run} B`,
  });
  const bWorldId = bCreate.json?.world?.id;
  state.bWorldId = bWorldId;
  context.cleanup.push(async () => {
    if (bWorldId) await call("DELETE", `${config.API}/v1/worlds/${bWorldId}`, state.tokenB);
  });
  const bwt = await call(
    "POST",
    `${config.API}/v1/worlds/${bWorldId}/auth/tokens`,
    state.tokenB,
    { name: `${context.run}-bwt` },
  );
  const bWorldToken = bwt.json?.token?.token;
  if (bWorldToken) evidence.secrets.add(bWorldToken);
  state.bWorldToken = bWorldToken;
  const crossData = await call(
    "POST",
    `${config.DATA}/worlds/${state.worldId}/sparql`,
    bWorldToken,
    { query: "SELECT * WHERE { ?s ?p ?o } LIMIT 1" },
  );
  record(
    "cross-world data-plane access denied (B's world token -> A's world)",
    [401, 403, 404].includes(crossData.status),
    "world token scoped to its own world",
    crossData,
  );
}

export async function assertVectorIsolation(context) {
  const { call, record, config, state } = context;
  if (!state.bWorldToken) return;
  // The vector index is shared across worlds and relies solely on the
  // world_id metadata filter, so a leak would surface as A's marker in B's
  // (empty) world, with a lexically disjoint query that only vectors reach.
  const isoVectors = await call(
    "POST",
    `${config.DATA}/worlds/${state.bWorldId}/search`,
    state.bWorldToken,
    { query: "an explanatory note covering retrieval validation" },
  );
  const isoHits = isoVectors.json?.results ?? [];
  record(
    "embeddings: cross-world isolation (B never sees A's vectors)",
    isoVectors.status === 200 &&
      !isoHits.some((hit) => JSON.stringify(hit).includes(context.MARKER)),
    `${isoHits.length} hit(s) in B's world, mode=${isoVectors.json?.mode}`,
    isoVectors,
  );
}

// A well-formed but nonexistent ID is not found (validity is not authorization).
export async function assertGhostRead(context) {
  const { call, record, config, state } = context;
  const ghost = "w_00000000000000000000000000";
  const ghostRead = await call("GET", `${config.API}/v1/worlds/${ghost}`, state.tokenA);
  record(
    "well-formed unknown ID -> 404",
    ghostRead.status === 404,
    "no existence leak",
    ghostRead,
  );
}

export async function deleteAndVerify(context) {
  const { call, record, config, state } = context;
  if (state.worldToken)
    await call(
      "DELETE",
      `${config.API}/v1/worlds/${state.worldId}/auth/tokens/${state.worldTokenUid ?? ""}`,
      state.tokenA,
    );
  const del = await call("DELETE", `${config.API}/v1/worlds/${state.worldId}`, state.tokenA);
  record(
    "delete (user A)",
    del.status >= 200 && del.status < 300,
    "deleted",
    del,
  );
  const after = await call("GET", `${config.API}/v1/worlds/${state.worldId}`, state.tokenA);
  record(
    "read after delete",
    after.status === 404 || after.json?.world?.state === "DELETED",
    `state=${after.json?.world?.state ?? "gone"}`,
    after,
  );
}
