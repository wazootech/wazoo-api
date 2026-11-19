// QA round trip scenario: search verification, including the hybrid polling
// (wazoo-api#149). Behavior identical to the pre-split inline code.

async function searchUntil(context, query, done, timeoutMs = 240_000) {
  const { call, state } = context;
  const started = Date.now();
  for (;;) {
    const res = await call(
      "POST",
      `${context.config.DATA}/worlds/${state.worldId}/search`,
      state.worldToken,
      { query },
    );
    const waited = Math.round((Date.now() - started) / 1000);
    if (!context.config.HYBRID || done(res) || Date.now() - started > timeoutMs)
      return { res, waited };
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

export async function assertSearch(context) {
  const { record } = context;
  const { res: search, waited } = await searchUntil(
    context,
    context.MARKER,
    (r) => r.json?.mode === "hybrid",
  );
  const hits = search.json?.results ?? [];
  record(
    "search finds reindexed content",
    search.status === 200 &&
      hits.some((hit) => JSON.stringify(hit).includes(context.MARKER)),
    `${hits.length} hit(s), mode=${search.json?.mode}`,
    search,
  );
  if (!context.config.HYBRID) return;
  const hit = hits.find((h) => JSON.stringify(h).includes(context.MARKER));
  record(
    "embeddings: marker search is hybrid and ranked",
    search.status === 200 &&
      search.json?.mode === "hybrid" &&
      hit !== undefined &&
      hit.scoreType !== "unranked",
    `mode=${search.json?.mode} scoreType=${hit?.scoreType} waitedForHybrid=${waited}s`,
    search,
  );

  // A query sharing no lexeme with the document proves the vector path: pure
  // full-text search would return nothing for it.
  const paraphrase = "an explanatory note covering retrieval validation";
  // No shared words means no keyword signal, so the vector-only mode
  // ("semantic") is the expected one here; "hybrid" is also accepted.
  const vectorMode = (r) =>
    r.json?.mode === "hybrid" || r.json?.mode === "semantic";
  const { res: pSearch } = await searchUntil(context, paraphrase, vectorMode);
  const pHits = pSearch.json?.results ?? [];
  record(
    "embeddings: paraphrase (no marker tokens) returns the document",
    pSearch.status === 200 &&
      vectorMode(pSearch) &&
      pHits.some((h) => JSON.stringify(h).includes(context.MARKER)),
    `${pHits.length} hit(s), mode=${pSearch.json?.mode}`,
    pSearch,
  );
}
