// Data-plane world-scoped routes for the script mock server (wazoo-api#149):
// import, SPARQL, export, search and reindex, all gated on a world token bound
// to exactly that world so cross-world access denies for real.
import { worldForToken } from "./access.mjs";
import { sparqlEngine } from "./sparql.mjs";
import { importHandler } from "./data-plane.mjs";

export function worldDataRoutes(state) {
  const route = (method, pattern, run) => ({
    method,
    plane: "data",
    pattern,
    handle: (request, match) => {
      const world = worldForToken(state, request.token, match[1]);
      if (!world) return { status: 401, json: { error: "world token required" } };
      return run(world, request, match);
    },
  });
  return [
    route("POST", /^\/worlds\/([^/]+)\/import$/, (world, { body }) =>
      importHandler()(world, body),
    ),
    route("POST", /^\/worlds\/([^/]+)\/sparql$/, (world, { body }) =>
      sparqlEngine(world)(body?.query ?? ""),
    ),
    route("GET", /^\/worlds\/([^/]+)\/export$/, exportRoute),
    route("POST", /^\/worlds\/([^/]+)\/search$/, (world, { body }) =>
      searchRoute(world, body?.query, state),
    ),
    route("POST", /^\/worlds\/([^/]+)\/reindex$/, (world) => reindexRoute(world, state)),
  ];
}

function exportRoute(world, { url }) {
  const format = url.searchParams.get("format") ?? "text/plain";
  if (format === "text/turtle")
    return {
      status: 200,
      text: world.triples
        .map((triple) => `${triple[0]} ${triple[1]} "${triple[2]}" .`)
        .join("\n"),
    };
  if (format === "application/json")
    return {
      status: 200,
      json: {
        quads: world.quads.map((quad) => ({
          subject: quad.subject,
          predicate: quad.predicate,
          object: quad.object,
        })),
      },
    };
  return { status: 200, text: world.chunks.join("\n") };
}

function corpusOf(world) {
  return [
    ...world.chunks,
    ...world.triples.map((triple) => triple.join(" ")),
    ...world.quads.map((quad) => `${quad.subject} ${quad.predicate} ${quad.object}`),
  ];
}

function searchRoute(world, query, state) {
  const corpus = corpusOf(world);
  const tokens = String(query ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const hits = corpus.filter((item) => {
    const lower = item.toLowerCase();
    return tokens.some((token) => lower.includes(token));
  });
  // With an active embedding credential, a lexically disjoint query comes back
  // as a semantic (vector) hit over the stored content; otherwise keyword only.
  const mode = state.credentialActive ? (hits.length ? "hybrid" : "semantic") : "keyword";
  const results = hits.length
    ? hits.map((text) => ({ text, scoreType: "lexical" }))
    : mode === "semantic"
      ? corpus.map((text) => ({ text, scoreType: "vector" }))
      : [];
  return { status: 200, json: { mode, results } };
}

function reindexRoute(world, state) {
  const processedQuadCount = world.triples.length + world.quads.length;
  const json = {
    status: "completed",
    processedQuadCount,
    chunkRowCount: Math.max(1, processedQuadCount),
  };
  if (state.credentialActive)
    json.vectorSync = { enabled: true, failedUpserts: 0, embeddingFailures: 0 };
  return { status: 200, json };
}
