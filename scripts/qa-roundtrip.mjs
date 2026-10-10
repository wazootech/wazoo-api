// QA world-identity round trip (wazoo-api#72; #63 criterion 6).
// Run: infisical run --env=qa -- pnpm run roundtrip:qa [evidence.json]
// QA hosts only; never prints token values. Writes evidence JSON to argv[2].
import { writeFileSync } from "node:fs";

const API = "https://api-qa.wazoo.dev";
const DATA = "https://data-qa.wazoo.dev";
const ADMIN = process.env.WAZOO_PLATFORM_ADMIN_TOKEN;
if (!ADMIN) throw new Error("WAZOO_PLATFORM_ADMIN_TOKEN missing");
const evidencePath = process.argv[2];

const run = `rt${Date.now()}`;
const emailA = `e2e+${run}-a@wazoo.dev`;
const emailB = `e2e+${run}-b@wazoo.dev`;
const WORLD_ID_RE =
  /^w_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MARKER = `zephyrquokka${run}`;

const evidence = { startedAt: new Date().toISOString(), run, steps: [] };
const secrets = new Set([ADMIN]);
let failed = false;

function redact(value) {
  let text = typeof value === "string" ? value : JSON.stringify(value);
  for (const secret of secrets) if (secret) text = text.split(secret).join("[redacted]");
  return text;
}

async function call(method, url, token, body) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

function record(name, pass, detail, response) {
  if (!pass) failed = true;
  const entry = {
    name,
    pass,
    detail: redact(detail),
    status: response?.status,
    body: response ? redact(response.text).slice(0, 400) : undefined,
  };
  evidence.steps.push(entry);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}: ${entry.detail}${response ? ` [${response.status}]` : ""}`);
  return pass;
}

async function mintPlatformToken(email, label) {
  await call("GET", `${API}/v1/users/me?email=${encodeURIComponent(email)}`, ADMIN);
  const res = await call("POST", `${API}/v1/auth/api-tokens`, ADMIN, {
    email,
    tokenName: `${run}-${label}`,
    scope: "users.read worlds.read worlds.write usage.read",
  });
  const token = res.json?.token?.token ?? res.json?.token ?? res.json?.apiToken?.token;
  if (typeof token === "string") secrets.add(token);
  record(`mint platform token (${label})`, res.status === 201 && typeof token === "string",
    "non-admin user token minted", res);
  return token;
}

const cleanup = [];
try {
  for (const url of [`${API}/ready`, `${DATA}/ready`]) {
    const res = await call("GET", url, "none");
    record(`readiness ${new URL(url).host}`, res.status === 200, "full /ready body recorded", res);
  }

  const tokenA = await mintPlatformToken(emailA, "a");
  const tokenB = await mintPlatformToken(emailB, "b");
  cleanup.push(async () => {
    for (const [email, label] of [[emailA, "a"], [emailB, "b"]]) {
      const res = await call("DELETE",
        `${API}/v1/auth/api-tokens/${run}-${label}?email=${encodeURIComponent(email)}`, ADMIN);
      record(`cleanup platform token (${label})`, res.status < 300 || res.status === 404, "revoked", res);
    }
  });

  // Create as user A with A's own token: display name only.
  const create = await call("POST", `${API}/v1/worlds`, tokenA,
    { world: { displayName: `Round trip ${run}` } });
  const worldId = create.json?.world?.id;
  record("create (user A, displayName only)",
    create.status === 201 && WORLD_ID_RE.test(worldId ?? "") && !("slug" in (create.json?.world ?? {})),
    `minted ${worldId}`, create);
  cleanup.push(async () => {
    await call("DELETE", `${API}/v1/worlds/${worldId}`, tokenA);
  });

  const read = await call("GET", `${API}/v1/worlds/${worldId}`, tokenA);
  record("read (user A)", read.status === 200 && read.json?.world?.id === worldId,
    "same id returned", read);

  const list = await call("GET", `${API}/v1/worlds`, tokenA);
  record("list (user A)", list.status === 200 &&
    (list.json?.worlds ?? []).some((w) => w.id === worldId), "world present in A's list", list);

  const wt = await call("POST", `${API}/v1/worlds/${worldId}/auth/tokens`, tokenA, { name: `${run}-wt` });
  const worldToken = wt.json?.token?.token;
  if (worldToken) secrets.add(worldToken);
  record("issue world token (user A)", wt.status === 201 && typeof worldToken === "string", "minted", wt);

  // Turtle with no contentType: exercises the documented default
  // (rejected before worlds-api#115).
  const turtle = `@prefix ex: <http://example.org/> .
ex:Doc1 ex:title "Round trip ${MARKER} document" ;
  ex:body "The ${MARKER} keyword proves search after reindex." .
ex:Doc2 ex:title "Second document" ; ex:ref ex:Doc1 .`;
  const imp = await call("POST", `${DATA}/worlds/${worldId}/import`, worldToken, { data: turtle });
  record("data-plane import (Turtle, default contentType, 4 triples)",
    imp.status === 200 && imp.json?.imported?.quads === 4, "imported 4 quads", imp);

  const count = await call("POST", `${DATA}/worlds/${worldId}/sparql`, worldToken,
    { query: "SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }" });
  const n = Number(count.json?.results?.bindings?.[0]?.n?.value);
  record("data-plane query (count)", count.status === 200 && n === 4, `count=${n}`, count);

  const exp = await call("GET", `${DATA}/worlds/${worldId}/export?format=text/turtle`, worldToken);
  record("data-plane export (turtle)", exp.status === 200 && exp.text.includes(MARKER),
    "export contains the imported marker literal", { ...exp, text: exp.text.slice(0, 300) });

  const reindex = await call("POST", `${DATA}/worlds/${worldId}/reindex`, worldToken);
  record("reindex", reindex.status === 200 && reindex.json?.status === "completed" &&
    reindex.json?.processedQuadCount >= 4 && reindex.json?.chunkRowCount > 0,
    `processedQuadCount=${reindex.json?.processedQuadCount} chunkRowCount=${reindex.json?.chunkRowCount}`, reindex);

  const search = await call("POST", `${DATA}/worlds/${worldId}/search`, worldToken, { query: MARKER });
  const hits = search.json?.results ?? [];
  record("search finds reindexed content", search.status === 200 &&
    hits.some((h) => JSON.stringify(h).includes(MARKER)),
    `${hits.length} hit(s), mode=${search.json?.mode}`, search);

  // Cross-user denial: B holds a valid w_<UUIDv4> that belongs to A.
  const bRead = await call("GET", `${API}/v1/worlds/${worldId}`, tokenB);
  record("cross-user read denied (B -> A's world)", bRead.status === 404 || bRead.status === 403,
    "owner predicate refuses a valid foreign ID", bRead);
  const bList = await call("GET", `${API}/v1/worlds`, tokenB);
  record("cross-user list excludes A's world", bList.status === 200 &&
    !(bList.json?.worlds ?? []).some((w) => w.id === worldId), "not visible to B", bList);
  const bToken = await call("POST", `${API}/v1/worlds/${worldId}/auth/tokens`, tokenB, { name: `${run}-steal` });
  record("cross-user world-token mint denied", bToken.status === 404 || bToken.status === 403,
    "B cannot mint a token for A's world", bToken);
  const bDelete = await call("DELETE", `${API}/v1/worlds/${worldId}`, tokenB);
  record("cross-user delete denied", bDelete.status === 404 || bDelete.status === 403,
    "B cannot delete A's world", bDelete);

  // B's own world token must not reach A's data plane.
  const bCreate = await call("POST", `${API}/v1/worlds`, tokenB, { world: { displayName: `Round trip ${run} B` } });
  const bWorldId = bCreate.json?.world?.id;
  cleanup.push(async () => { if (bWorldId) await call("DELETE", `${API}/v1/worlds/${bWorldId}`, tokenB); });
  const bwt = await call("POST", `${API}/v1/worlds/${bWorldId}/auth/tokens`, tokenB, { name: `${run}-bwt` });
  const bWorldToken = bwt.json?.token?.token;
  if (bWorldToken) secrets.add(bWorldToken);
  const crossData = await call("POST", `${DATA}/worlds/${worldId}/sparql`, bWorldToken,
    { query: "SELECT * WHERE { ?s ?p ?o } LIMIT 1" });
  record("cross-world data-plane access denied (B's world token -> A's world)",
    [401, 403, 404].includes(crossData.status), "world token scoped to its own world", crossData);

  // A well-formed but nonexistent ID is not found (validity is not authorization).
  const ghost = "w_00000000-0000-4000-8000-000000000000";
  const ghostRead = await call("GET", `${API}/v1/worlds/${ghost}`, tokenA);
  record("well-formed unknown ID -> 404", ghostRead.status === 404, "no existence leak", ghostRead);

  // Delete as A and verify.
  if (worldToken) await call("DELETE", `${API}/v1/worlds/${worldId}/auth/tokens/${wt.json?.token?.uid ?? ""}`, tokenA);
  const del = await call("DELETE", `${API}/v1/worlds/${worldId}`, tokenA);
  record("delete (user A)", del.status >= 200 && del.status < 300, "deleted", del);
  const after = await call("GET", `${API}/v1/worlds/${worldId}`, tokenA);
  record("read after delete", after.status === 404 || after.json?.world?.state === "DELETED",
    `state=${after.json?.world?.state ?? "gone"}`, after);
} catch (error) {
  record("unexpected error", false, String(error));
} finally {
  for (const step of cleanup.reverse()) {
    try { await step(); } catch (error) { record("cleanup error", false, String(error)); }
  }
  evidence.finishedAt = new Date().toISOString();
  evidence.result = failed ? "FAIL" : "PASS";
  if (evidencePath) writeFileSync(evidencePath, redact(JSON.stringify(evidence, null, 2)));
  console.log(`Round trip ${evidence.result}`);
  process.exit(failed ? 1 : 0);
}
