// A tiny Turtle statement parser for the script mock server (wazoo-api#149):
// enough for the round trip's fixture document. Handles @prefix lines (skipped,
// prefixes are not resolved), ";" predicate lists and "." terminators, and
// returns [subject, predicate, object] triples with objects unquoted. Literal
// contents are masked before splitting so a "." inside a quoted literal (the
// fixture's "reindex." sentence) does not cut a statement in half.
export function parseTurtleTriples(text) {
  const triples = [];
  let subject = null;
  const literals = [];
  const body = text
    .split("\n")
    .filter((line) => !line.trim().startsWith("@"))
    .join("\n");
  const masked = body.replace(/"([^"]*)"/g, (_, value) => {
    literals.push(value);
    return `@lit${literals.length - 1}@`;
  });
  for (const rawSegment of masked.split(/[;.]/)) {
    const segment = rawSegment.trim();
    if (!segment) continue;
    const literal = segment.match(/@lit(\d+)@/);
    const iri = segment.match(/<([^>]*)>/);
    const tokens = segment
      .replace(/@lit\d+@/g, "Q")
      .replace(/<[^>]*>/g, "I")
      .split(/\s+/)
      .filter(Boolean);
    if (tokens.length >= 2) {
      subject = tokens.length >= 3 ? tokens[0] : (subject ?? tokens[0]);
      const predicate = tokens.length >= 3 ? tokens[1] : tokens[0];
      const object = literal
        ? literals[Number(literal[1])]
        : iri
          ? iri[1]
          : tokens[tokens.length - 1];
      triples.push([subject, predicate, object]);
    }
  }
  return triples;
}
