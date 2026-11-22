// Private beta health: data-plane and metering step functions (wazoo-api#149).
// Behavior identical to the pre-split inline code.
import { assert, worldsRequest } from "./client.mjs";

export async function importChunks(context) {
  const response = await worldsRequest(context)(
    `/worlds/${context.state.worldId}/import`,
    {
      method: "POST",
      body: {
        contentType: "text/plain",
        data: `health:alpha\tWazoo health alpha ${context.runId}\nhealth:beta\tWazoo health beta ${context.runId}`,
      },
    },
  );
  assert(response.body.imported.chunks === 2, "Chunk import count mismatch");
  return response;
}

export async function importQuads(context) {
  const response = await worldsRequest(context)(
    `/worlds/${context.state.worldId}/import`,
    {
      method: "POST",
      body: {
        contentType: "application/json",
        data: JSON.stringify([
          {
            subject: `urn:wazoo:health:${context.runId}:alpha`,
            predicate: "http://schema.org/name",
            object: `Alpha ${context.runId}`,
          },
          {
            subject: `urn:wazoo:health:${context.runId}:alpha`,
            predicate: "http://schema.org/knows",
            object: `urn:wazoo:health:${context.runId}:beta`,
          },
        ]),
      },
    },
  );
  assert(response.body.imported.quads === 2, "Quad import count mismatch");
  return response;
}

export async function searchWorld(context) {
  const response = await worldsRequest(context)(
    `/worlds/${context.state.worldId}/search`,
    {
      method: "POST",
      body: { query: `alpha ${context.runId}`, limit: 5 },
    },
  );
  assert(response.body.results.length > 0, "Search returned no results");
  return response;
}

export async function exportChunks(context) {
  const response = await worldsRequest(context)(
    `/worlds/${context.state.worldId}/export?format=text/plain`,
  );
  assert(
    String(response.body).includes(`Wazoo health alpha ${context.runId}`),
    "Chunk export missing alpha text",
  );
  return response;
}

export async function exportQuads(context) {
  const response = await worldsRequest(context)(
    `/worlds/${context.state.worldId}/export?format=application/json`,
  );
  assert(
    response.body.quads.some(
      (quad) => quad.subject === `urn:wazoo:health:${context.runId}:alpha`,
    ),
    "Quad export missing alpha subject",
  );
  return response;
}

export async function sparqlSelect(context) {
  const response = await worldsRequest(context)(
    `/worlds/${context.state.worldId}/sparql`,
    {
      method: "POST",
      body: {
        query: `SELECT ?name WHERE { <urn:wazoo:health:${context.runId}:alpha> <http://schema.org/name> ?name } LIMIT 5`,
      },
    },
  );
  assert(
    response.body.results.bindings.some(
      (binding) => binding.name?.value === `Alpha ${context.runId}`,
    ),
    "SPARQL SELECT missing expected binding",
  );
  return response;
}

export async function sparqlAsk(context) {
  const response = await worldsRequest(context)(
    `/worlds/${context.state.worldId}/sparql`,
    {
      method: "POST",
      body: {
        query: `ASK WHERE { <urn:wazoo:health:${context.runId}:alpha> <http://schema.org/knows> <urn:wazoo:health:${context.runId}:beta> }`,
      },
    },
  );
  assert(response.body.boolean === true, "SPARQL ASK was not true");
  return response;
}
