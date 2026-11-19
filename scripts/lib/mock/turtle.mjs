// A tiny Turtle statement parser for the script mock server (wazoo-api#149):
// enough for the round trip's fixture document. Handles @prefix lines (skipped,
// prefixes are not resolved), ";" predicate lists and "." terminators, and
// returns [subject, predicate, object] triples with objects unquoted.
export function parseTurtleTriples(text) {
  const triples = [];
  let subject = null;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("@")) continue;
    for (const rawSegment of line.split(/[;.]/)) {
      const segment = rawSegment.trim();
      if (!segment) continue;
      const literal = segment.match(/"([^"]*)"/);
      const iri = segment.match(/<([^>]*)>/);
      const skeleton = segment.replace(/"[^"]*"/g, "Q").replace(/<[^>]*>/g, "I");
      const tokens = skeleton.split(/\s+/).filter(Boolean);
      if (tokens.length >= 2) {
        subject = tokens.length >= 3 ? tokens[0] : (subject ?? tokens[0]);
        const predicate = tokens.length >= 3 ? tokens[1] : tokens[0];
        const object = literal ? literal[1] : iri ? iri[1] : tokens[tokens.length - 1];
        triples.push([subject, predicate, object]);
      }
    }
  }
  return triples;
}
