// Platform smoke gate: data-plane SPARQL round trip and world cleanup
// (wazoo-api#149). Behavior identical to the pre-split inline code.
import { check, jsonOrNull } from "./helpers.mjs";

export async function testSparqlQuery(context, worldToken, canonicalId) {
  const { WORLDS_API_URL, http } = context;
  return check("testSparqlQuery", async () => {
    if (!worldToken) {
      return {
        name: "testSparqlQuery",
        passed: false,
        detail: "no world token on context; run testTokenManagement first",
      };
    }
    const worldId = canonicalId;
    if (!worldId) {
      return {
        name: "testSparqlQuery",
        passed: false,
        detail: "no canonical world ID on context",
      };
    }
    const headers = {
      Authorization: `Bearer ${worldToken}`,
      "Content-Type": "application/json",
    };
    const insertResponse = await http(`${WORLDS_API_URL}/worlds/${worldId}/sparql`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: `PREFIX ex: <http://example.org/>
INSERT DATA {
  ex:Alice ex:name "Alice" ;
           ex:age "30" ;
           ex:city "Portland" .
}`,
      }),
    });
    if (insertResponse.status !== 200) {
      return {
        name: "testSparqlQuery",
        passed: false,
        detail: `sparql insert: expected 200, got ${insertResponse.status}`,
      };
    }
    const selectResponse = await http(`${WORLDS_API_URL}/worlds/${worldId}/sparql`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: `PREFIX ex: <http://example.org/>
SELECT ?name ?age ?city WHERE {
  ex:Alice ex:name ?name ;
           ex:age ?age ;
           ex:city ?city .
}`,
      }),
    });
    if (selectResponse.status !== 200) {
      return {
        name: "testSparqlQuery",
        passed: false,
        detail: `sparql select: expected 200, got ${selectResponse.status}`,
      };
    }
    const result = await jsonOrNull(selectResponse);
    const bindings = result?.results?.bindings;
    if (!bindings || bindings.length < 1) {
      return {
        name: "testSparqlQuery",
        passed: false,
        detail: "sparql select: no bindings returned",
      };
    }
    const first = bindings[0];
    for (const [key, expected] of [
      ["name", "Alice"],
      ["age", "30"],
      ["city", "Portland"],
    ]) {
      if (first[key]?.value !== expected) {
        return {
          name: "testSparqlQuery",
          passed: false,
          detail: `sparql select: expected ${key}=${expected}, got ${first[key]?.value}`,
        };
      }
    }
    return {
      name: "testSparqlQuery",
      passed: true,
      detail: "SPARQL insert + select round-tripped correctly",
    };
  });
}

export async function cleanupWorld(context, worldId) {
  const { API_BASE_URL, ADMIN, ownerEmail, http } = context;
  return check("cleanupWorld", async () => {
    if (!worldId) {
      return {
        name: "cleanupWorld",
        passed: true,
        detail: "no canonical world ID was created; cleanup skipped",
      };
    }
    const response = await http(
      `${API_BASE_URL}/v1/worlds/${worldId}?email=${encodeURIComponent(ownerEmail)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${ADMIN}` } },
    );
    const passed = response.ok || response.status === 404;
    return {
      name: "cleanupWorld",
      passed,
      detail: passed
        ? response.status === 404
          ? `world ${worldId} did not exist; nothing to delete`
          : `deleted world ${worldId}`
        : `delete world: expected ok or 404, got ${response.status}`,
    };
  });
}
