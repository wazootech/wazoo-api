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

  it("documents the auth entrypoints so generated clients can log in", () => {
    const doc = app.getOpenAPIDocument(openApiDocOptions);
    const paths = doc.paths as Record<string, Record<string, any>>;

    const login = paths["/v1/auth/login"]?.post;
    const verify = paths["/v1/auth/verify"]?.post;
    const session = paths["/v1/auth/workos-session"]?.post;

    expect(login?.operationId).toBe("login");
    expect(verify?.operationId).toBe("verifyLogin");
    expect(session?.operationId).toBe("createWorkosSession");

    // Login and verify are the unauthenticated bootstrap flow: they must opt
    // out of the document-level bearer requirement or clients will refuse to
    // call them without a token.
    expect(login?.security).toEqual([]);
    expect(verify?.security).toEqual([]);
    // The admin-only session mint stays behind the platform token.
    expect(session?.security).toEqual([{ bearerPlatformToken: [] }]);
  });

  it("serves the auth routes without requiring a bearer token", async () => {
    // A malformed body keeps the pre-OpenAPI lenient behavior (empty email).
    const res = await app.request("/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: 42 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const verify = await app.request("/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(verify.status).toBe(400);
    expect(await verify.json()).toMatchObject({
      error: { code: "INVALID_ARGUMENT" },
    });
  });
});
