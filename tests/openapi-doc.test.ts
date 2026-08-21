import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import app, { openApiDocOptions } from "../src/index";

const snapshotPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../openapi/openapi.json",
);

describe("OpenAPI document", () => {
  it("matches the committed openapi/openapi.json snapshot", () => {
    const doc = app.getOpenAPIDocument(openApiDocOptions);
    const serialized = `${JSON.stringify(doc, null, 2)}\n`;

    if (process.env.SYNC_OPENAPI === "1") {
      mkdirSync(dirname(snapshotPath), { recursive: true });
      writeFileSync(snapshotPath, serialized);
      return;
    }

    const committed = readFileSync(snapshotPath, "utf8");
    expect(serialized).toBe(committed);
  });
});
