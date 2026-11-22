// A deliberately tiny SPARQL subset behind the scripts' mock server
// (wazoo-api#149): only what the operational scripts assert on — SELECT with
// fixed or bound triple patterns, COUNT(*), ASK, INSERT DATA — plus the
// worlds-api#187 refusal of remote LOAD. Not a real engine; anything
// unrecognized is a 400, which is the safe failure direction.

const VAR = /^\?(\w+)$/;
const LITERAL = /"([^"]*)"/g;
const IRI = /<([^>]*)>/g;

// Masks quoted literals and angle-bracket IRIs before any splitting, so a "."
// inside <http://schema.org/name> or a quoted sentence never cuts a pattern.
function maskTerms(block) {
  const literals = [];
  const iris = [];
  const masked = block
    .replace(LITERAL, (_, value) => {
      literals.push(value);
      return `@lit${literals.length - 1}@`;
    })
    .replace(IRI, (_, value) => {
      iris.push(value);
      return `@iri${iris.length - 1}@`;
    });
  return { masked, literals, iris };
}

function termOf(token, literals, iris) {
  if (token.startsWith("@lit"))
    return { kind: "value", value: literals[Number(token.slice(4, -1))] };
  if (token.startsWith("@iri"))
    return { kind: "value", value: iris[Number(token.slice(4, -1))] };
  const v = VAR.exec(token);
  if (v) return { kind: "var", name: v[1] };
  return { kind: "value", value: token };
}

// Splits a WHERE/INSERT block into [s, p, o] term tokens, carrying the subject
// across ";" continuations like the tiny turtle parser does.
function patternsOf(block) {
  const { masked, literals, iris } = maskTerms(block);
  const patterns = [];
  let subject = null;
  for (const raw of masked.split(/[;.]/)) {
    const segment = raw.trim();
    if (!segment) continue;
    const terms = segment.split(/\s+/).filter(Boolean).map((token) => termOf(token, literals, iris));
    if (terms.length >= 3) {
      subject = terms[0];
      patterns.push([terms[0], terms[1], terms[terms.length - 1]]);
    } else if (terms.length === 2 && subject) {
      patterns.push([subject, terms[0], terms[1]]);
    }
  }
  return patterns;
}

function matchesPattern(pattern, triple, binding) {
  const extended = { ...binding };
  for (let i = 0; i < 3; i++) {
    const term = pattern[i];
    if (term.kind === "var") {
      const bound = extended[term.name];
      if (bound === undefined) extended[term.name] = triple[i];
      else if (bound !== triple[i]) return null;
    } else if (String(term.value) !== String(triple[i])) return null;
  }
  return extended;
}

function solve(triples, block) {
  let solutions = [{}];
  for (const pattern of patternsOf(block)) {
    const next = [];
    for (const binding of solutions)
      for (const triple of triples) {
        const extended = matchesPattern(pattern, triple, binding);
        if (extended) next.push(extended);
      }
    solutions = next;
  }
  return solutions;
}

export function sparqlEngine(world) {
  return (query) => {
    // PREFIX declarations carry no triples; drop them before matching.
    const q = query
      .split("\n")
      .filter((line) => !/^\s*PREFIX\b/i.test(line))
      .join("\n")
      .trim();
    if (/^LOAD\b/i.test(q))
      return { status: 400, text: "policy: remote LOAD is not permitted" };
    const insert = q.match(/^INSERT\s+DATA\s*\{([\s\S]*)\}\s*$/i);
    if (insert) {
      for (const pattern of patternsOf(insert[1]))
        world.triples.push(pattern.map((term) => String(term.value)));
      return { status: 200, json: {} };
    }
    const ask = q.match(/^ASK\b[\s\S]*?\{([\s\S]*)\}\s*$/i);
    if (ask) {
      const solutions = /GRAPH/i.test(ask[1]) ? [] : solve(world.triples, ask[1]);
      return { status: 200, json: { boolean: solutions.length > 0 } };
    }
    const select = q.match(/^SELECT\b([^{]*)\{([\s\S]*)\}/i);
    if (select) {
      const count = select[1].match(/COUNT\s*\(\s*\*\s*\)\s+AS\s+\?(\w+)/i);
      const solutions = solve(world.triples, select[2]);
      if (count) {
        const binding = solutions.length
          ? { [count[1]]: { type: "literal", value: String(solutions.length) } }
          : {};
        return { status: 200, json: { results: { bindings: solutions.length ? [binding] : [] } } };
      }
      const vars = [...select[1].matchAll(/\?(\w+)/g)].map((m) => m[1]);
      const limit = q.match(/LIMIT\s+(\d+)/i);
      const rows = solutions
        .slice(0, limit ? Number(limit[1]) : solutions.length)
        .map((binding) =>
          Object.fromEntries(
            vars
              .filter((name) => binding[name] !== undefined)
              .map((name) => [name, { type: "literal", value: String(binding[name]) }]),
          ),
        );
      return { status: 200, json: { results: { bindings: rows } } };
    }
    return { status: 400, text: "mock sparql: unsupported query" };
  };
}
