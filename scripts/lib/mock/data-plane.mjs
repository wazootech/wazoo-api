// Data-plane (worlds-api) routes for the script mock server (wazoo-api#149):
// health, namespace-level refusals, embedding-model patch, and import counts
// derived from the posted body.
import { isDataAdmin } from "./state.mjs";
import { parseTurtleTriples } from "./turtle.mjs";
import { worldForToken } from "./access.mjs";

export const DATA_OPENAPI = {
  openapi: "3.1.0",
  paths: { "/health": {}, "/ready": {}, "/worlds": {}, "/sparql": {} },
  info: { title: "Worlds API (mock)", version: "0.0.0" },
};

export function dataPlaneBaseRoutes(state) {
  return [
    {
      method: "GET",
      plane: "data",
      pattern: /^\/(ready|health|openapi\.json)$/,
      handle: ({ url }) =>
        url.pathname === "/ready"
          ? { status: 200, json: { status: "ready" } }
          : url.pathname === "/health"
            ? { status: 200, json: { status: "ok" } }
            : { status: 200, json: DATA_OPENAPI },
    },
    {
      method: "GET",
      plane: "data",
      pattern: /^\/worlds$/,
      handle: ({ token }) => namespaceRefusal(token),
    },
    {
      method: "POST",
      plane: "data",
      pattern: /^\/worlds$/,
      handle: ({ token }) => namespaceRefusal(token),
    },
    {
      method: "PATCH",
      plane: "data",
      pattern: /^\/worlds\/([^/]+)$/,
      handle: ({ token, body }, match) => {
        if (!isDataAdmin(state, token))
          return { status: 401, json: { error: "data admin required" } };
        const world = state.worlds.get(match[1]);
        if (!world) return { status: 404, json: { error: "not found" } };
        if (body?.embeddingModel !== undefined) {
          world.embeddingModel = body.embeddingModel;
          world.embeddingStatus = "stale";
        }
        return {
          status: 200,
          json: {
            embeddingModel: world.embeddingModel,
            embeddingStatus: world.embeddingStatus,
          },
        };
      },
    },
  ];
}

// A world-bound key may not use namespace-level routes (worlds-api#182);
// unauthenticated callers fail at the auth boundary first.
function namespaceRefusal(token) {
  return !token
    ? { status: 401, json: { error: "unauthenticated" } }
    : { status: 403, json: { error: "world-bound keys may not use namespace routes" } };
}

export function importCounts(body) {
  const contentType = body?.contentType ?? "text/turtle";
  const data = typeof body?.data === "string" ? body.data : "";
  if (contentType === "text/plain") {
    const chunks = data.split("\n").filter(Boolean);
    return { chunks, quads: [], triples: [] };
  }
  if (contentType === "application/json") {
    let rows;
    try {
      rows = JSON.parse(data);
    } catch {
      rows = [];
    }
    // Quads are projected into the triple store by the import handler.
    return { chunks: [], quads: rows, triples: [] };
  }
  return { chunks: [], quads: [], triples: parseTurtleTriples(data) };
}

export function importHandler() {
  return (world, body) => {
    const imported = importCounts(body);
    world.chunks.push(...imported.chunks);
    world.quads.push(...imported.quads);
    world.triples.push(...imported.triples);
    // Quad imports are queryable through SPARQL too.
    for (const quad of imported.quads)
      world.triples.push([quad.subject, quad.predicate, quad.object]);
    return {
      status: 200,
      json: {
        imported: {
          chunks: imported.chunks.length,
          quads: imported.quads.length + imported.triples.length,
        },
      },
    };
  };
}

export { worldForToken };
