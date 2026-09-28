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
  it("uses worldId and tokenId for the public world-token route", () => {
    const doc = app.getOpenAPIDocument(openApiDocOptions);
    const operation =
      doc.paths["/v1/worlds/{worldId}/auth/tokens/{tokenId}"]?.delete;
    const pathParams = operation?.parameters?.flatMap((param) =>
      "$ref" in param ? [] : param.in === "path" ? [param.name] : [],
    );
    expect(pathParams).toEqual(["worldId", "tokenId"]);
  });

  it("uses tokenId for platform-token revocation", () => {
    const doc = app.getOpenAPIDocument(openApiDocOptions);
    const operation = doc.paths["/v1/auth/api-tokens/{tokenId}"]?.delete;
    const pathParams = operation?.parameters?.flatMap((param) =>
      "$ref" in param ? [] : param.in === "path" ? [param.name] : [],
    );
    expect(pathParams).toEqual(["tokenId"]);
    expect(doc.paths["/v1/auth/api-tokens/{tokenName}"]).toBeUndefined();
  });

  it("declares every path parameter named in each path template", () => {
    const doc = app.getOpenAPIDocument(openApiDocOptions);
    const methods = new Set([
      "get",
      "put",
      "post",
      "delete",
      "options",
      "head",
      "patch",
      "trace",
    ]);

    for (const [path, pathItemValue] of Object.entries(doc.paths)) {
      const pathItem = pathItemValue as Record<string, unknown>;
      const expected = [...path.matchAll(/\{([^}]+)\}/g)]
        .map((match) => match[1])
        .sort();
      const pathLevel = Array.isArray(pathItem.parameters)
        ? (pathItem.parameters as Array<{ in?: string; name?: string }>)
        : [];

      for (const [method, operationValue] of Object.entries(pathItem)) {
        if (
          !methods.has(method) ||
          !operationValue ||
          typeof operationValue !== "object"
        )
          continue;
        const operation = operationValue as {
          parameters?: Array<{ in?: string; name?: string }>;
        };
        const declared = [...pathLevel, ...(operation.parameters ?? [])]
          .filter((parameter) => parameter.in === "path")
          .map((parameter) => parameter.name ?? "")
          .sort();
        expect([...new Set(declared)]).toEqual(expected);
      }
    }
  });

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
