import { describe, expect, it } from "vitest";
import app, { openApiDocOptions } from "../src/index";

type Json = Record<string, unknown>;
type Schema = {
  properties?: Record<string, Schema>;
  allOf?: Json[];
  type?: string;
} & Json;

const doc = app.getOpenAPIDocument(openApiDocOptions) as unknown as {
  paths: Record<string, Record<string, Json>>;
  components: { schemas: Record<string, Schema> };
};

function responseSchema(path: string, method: string, status: string) {
  const op = doc.paths[path]?.[method] as {
    responses: Record<string, { content: Record<string, { schema: Json }> }>;
  };
  return op.responses[status].content["application/json"].schema;
}

function resolve(schema: Json): Schema {
  const ref = schema.$ref as string | undefined;
  if (ref) return resolve(doc.components.schemas[ref.split("/").pop()!]);
  const parts = (schema as Schema).allOf;
  if (!parts) return schema as Schema;
  const merged = parts.map(resolve);
  return { properties: Object.assign({}, ...merged.map((p) => p.properties)) };
}

describe("world token OpenAPI contract", () => {
  const path = "/v1/worlds/{worldId}/auth/tokens";

  it("declares the one-time secret on the create 201 response", () => {
    const body = resolve(responseSchema(path, "post", "201"));
    const token = resolve(body.properties?.token as Json);
    expect(token.properties?.token?.type).toBe("string");
    expect(token.properties?.uid?.type).toBe("string");
  });

  it("does not advertise a secret on the list response or WorldToken", () => {
    const list = resolve(responseSchema(path, "get", "200"));
    const items = list.properties?.tokens as unknown as { items: Json };
    expect(resolve(items.items).properties).not.toHaveProperty("token");
    expect(doc.components.schemas.WorldToken.properties).not.toHaveProperty(
      "token",
    );
  });
});
