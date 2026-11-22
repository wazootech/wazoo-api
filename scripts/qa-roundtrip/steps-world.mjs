// QA round trip scenario: world lifecycle on the control plane and the data
// plane (create/read/list, world token, import, count, export, reindex)
// (wazoo-api#149). Behavior identical to the pre-split inline code.
import { WORLD_ID_RE } from "./context.mjs";

export async function createWorldAsA(context) {
  const { call, record, state } = context;
  const create = await call("POST", `${context.config.API}/v1/worlds`, state.tokenA, {
    displayName: `Round trip ${context.run}`,
  });
  const worldId = create.json?.world?.id;
  record(
    "create (user A, displayName only)",
    create.status === 201 &&
      WORLD_ID_RE.test(worldId ?? "") &&
      !("slug" in (create.json?.world ?? {})),
    `minted ${worldId}`,
    create,
  );
  state.worldId = worldId;
  context.cleanup.push(async () => {
    await call("DELETE", `${context.config.API}/v1/worlds/${worldId}`, state.tokenA);
  });
}

export async function readWorld(context) {
  const { call, record, state } = context;
  const read = await call("GET", `${context.config.API}/v1/worlds/${state.worldId}`, state.tokenA);
  record(
    "read (user A)",
    read.status === 200 && read.json?.world?.id === state.worldId,
    "same id returned",
    read,
  );
}

export async function listWorld(context) {
  const { call, record, state } = context;
  const list = await call("GET", `${context.config.API}/v1/worlds`, state.tokenA);
  record(
    "list (user A)",
    list.status === 200 &&
      (list.json?.worlds ?? []).some((world) => world.id === state.worldId),
    "world present in A's list",
    list,
  );
}

export async function issueWorldToken(context) {
  const { call, record, evidence, state, run } = context;
  const wt = await call(
    "POST",
    `${context.config.API}/v1/worlds/${state.worldId}/auth/tokens`,
    state.tokenA,
    { name: `${run}-wt` },
  );
  const worldToken = wt.json?.token?.token;
  if (worldToken) evidence.secrets.add(worldToken);
  record(
    "issue world token (user A)",
    wt.status === 201 && typeof worldToken === "string",
    "minted",
    wt,
  );
  state.worldToken = worldToken;
  state.worldTokenUid = wt.json?.token?.uid;
}

// Turtle with no contentType: exercises the documented default
// (rejected before worlds-api#115).
export function markerTurtle(context) {
  return `@prefix ex: <http://example.org/> .
ex:Doc1 ex:title "Round trip ${context.MARKER} document" ;
  ex:body "The ${context.MARKER} keyword proves search after reindex." .
ex:Doc2 ex:title "Second document" ; ex:ref ex:Doc1 .`;
}

export async function importAndVerify(context) {
  const { call, record, state } = context;
  const imp = await call(
    "POST",
    `${context.config.DATA}/worlds/${state.worldId}/import`,
    state.worldToken,
    { data: markerTurtle(context) },
  );
  record(
    "data-plane import (Turtle, default contentType, 4 triples)",
    imp.status === 200 && imp.json?.imported?.quads === 4,
    "imported 4 quads",
    imp,
  );
  const count = await call(
    "POST",
    `${context.config.DATA}/worlds/${state.worldId}/sparql`,
    state.worldToken,
    { query: "SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }" },
  );
  const n = Number(count.json?.results?.bindings?.[0]?.n?.value);
  record(
    "data-plane query (count)",
    count.status === 200 && n === 4,
    `count=${n}`,
    count,
  );
  const exp = await call(
    "GET",
    `${context.config.DATA}/worlds/${state.worldId}/export?format=text/turtle`,
    state.worldToken,
  );
  record(
    "data-plane export (turtle)", exp.status === 200 && exp.text.includes(context.MARKER),
    "export contains the imported marker literal", { ...exp, text: exp.text.slice(0, 300) },
  );
}

export async function reindex(context) {
  const { call, record, state } = context;
  const res = await call(
    "POST",
    `${context.config.DATA}/worlds/${state.worldId}/reindex`,
    state.worldToken,
  );
  record(
    "reindex",
    res.status === 200 &&
      res.json?.status === "completed" &&
      res.json?.processedQuadCount >= 4 &&
      res.json?.chunkRowCount > 0,
    `processedQuadCount=${res.json?.processedQuadCount} chunkRowCount=${res.json?.chunkRowCount}`,
    res,
  );
  return res;
}
