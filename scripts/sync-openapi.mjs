// Regenerates openapi/openapi.json from the running OpenAPIHono app by running
// the drift test in write mode (SYNC_OPENAPI=1). Vitest handles the TS import
// of src/index.ts natively, so no separate transpile step is needed.
import { startVitest } from "vitest/node";

process.env.SYNC_OPENAPI = "1";
await startVitest("test", ["tests/openapi-doc.test.ts"], {
  passWithNoTests: true,
  watch: false,
});
