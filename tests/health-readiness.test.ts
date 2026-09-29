import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import type { Bindings } from "../src/env";

type Column = { name: string; pk: number; notnull?: number };
type ForeignKey = {
  table: string;
  from: string;
  to: string;
  on_delete: string;
};

type Schema = {
  columns: Record<string, Column[]>;
  foreignKeys: Record<string, ForeignKey[]>;
  unavailable?: boolean;
};

const canonicalSchema: Schema = {
  columns: {
    worlds: [
      { name: "world_id", pk: 1, notnull: 1 },
      { name: "user_uid", pk: 0, notnull: 1 },
      { name: "display_name", pk: 0, notnull: 1 },
    ],
    usage_events: [{ name: "world_id", pk: 0, notnull: 0 }],
    world_limits: [
      { name: "world_id", pk: 1, notnull: 1 },
      { name: "metric", pk: 2, notnull: 1 },
    ],
  },
  foreignKeys: {
    worlds: [
      { table: "users", from: "user_uid", to: "uid", on_delete: "CASCADE" },
    ],
    usage_events: [
      {
        table: "worlds",
        from: "world_id",
        to: "world_id",
        on_delete: "SET NULL",
      },
    ],
    world_limits: [
      {
        table: "worlds",
        from: "world_id",
        to: "world_id",
        on_delete: "CASCADE",
      },
    ],
  },
};

function makeD1(schema: Schema): Bindings["DB"] {
  return {
    prepare(sql: string) {
      const statement = {
        bind: () => statement,
        async all() {
          if (schema.unavailable) throw new Error("D1 unavailable");
          const table = sql.match(
            /PRAGMA (?:table_info|foreign_key_list)\('([^']+)'\)/,
          )?.[1];
          if (!table) throw new Error(`Unexpected query: ${sql}`);
          if (sql.includes("table_info")) {
            return { results: schema.columns[table] ?? [] };
          }
          return { results: schema.foreignKeys[table] ?? [] };
        },
        async first() {
          if (schema.unavailable) throw new Error("D1 unavailable");
          if (sql !== "SELECT 1") throw new Error(`Unexpected query: ${sql}`);
          return { ok: 1 };
        },
        async run() {
          if (schema.unavailable) throw new Error("D1 unavailable");
          return { success: true };
        },
      };
      return statement;
    },
  } as unknown as Bindings["DB"];
}

async function request(path: string, schema: Schema) {
  const executionCtx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  return app.request(path, {}, { DB: makeD1(schema) }, executionCtx);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Wazoo API readiness", () => {
  it("accepts canonical world identity keys and references", async () => {
    const res = await request("/ready", canonicalSchema);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ready" });
  });

  it("rejects the legacy world row and world_uid references", async () => {
    const legacySchema: Schema = {
      columns: {
        worlds: [
          { name: "uid", pk: 1 },
          { name: "world_id", pk: 0 },
          { name: "worlds_api_uid", pk: 0 },
          { name: "slug", pk: 0 },
          { name: "user_uid", pk: 0 },
          { name: "display_name", pk: 0 },
        ],
        usage_events: [{ name: "world_uid", pk: 0 }],
        world_limits: [{ name: "world_uid", pk: 1 }],
      },
      foreignKeys: {
        worlds: [
          { table: "users", from: "user_uid", to: "uid", on_delete: "CASCADE" },
        ],
        usage_events: [
          {
            table: "worlds",
            from: "world_uid",
            to: "uid",
            on_delete: "SET NULL",
          },
        ],
        world_limits: [
          {
            table: "worlds",
            from: "world_uid",
            to: "uid",
            on_delete: "CASCADE",
          },
        ],
      },
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request("/ready", legacySchema);

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      status: "not_ready",
      error: "World identity schema is unavailable or incompatible",
    });
    expect(log).toHaveBeenCalledOnce();
  });

  it("rejects a legacy usage_events.world_uid reference", async () => {
    const staleReferences: Schema = {
      ...canonicalSchema,
      columns: {
        ...canonicalSchema.columns,
        usage_events: [{ name: "world_uid", pk: 0 }],
      },
      foreignKeys: {
        ...canonicalSchema.foreignKeys,
        usage_events: [
          {
            table: "worlds",
            from: "world_uid",
            to: "world_id",
            on_delete: "SET NULL",
          },
        ],
      },
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request("/ready", staleReferences);

    expect(res.status).toBe(503);
    expect(log).toHaveBeenCalledOnce();
  });

  it("rejects a legacy world_limits.world_uid reference", async () => {
    const staleReferences: Schema = {
      ...canonicalSchema,
      columns: {
        ...canonicalSchema.columns,
        world_limits: [
          { name: "world_uid", pk: 1 },
          { name: "metric", pk: 2 },
        ],
      },
      foreignKeys: {
        ...canonicalSchema.foreignKeys,
        world_limits: [
          {
            table: "worlds",
            from: "world_uid",
            to: "world_id",
            on_delete: "CASCADE",
          },
        ],
      },
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request("/ready", staleReferences);

    expect(res.status).toBe(503);
  });

  it("rejects missing or incorrect world foreign keys", async () => {
    const staleForeignKeySchema: Schema = {
      ...canonicalSchema,
      foreignKeys: {
        ...canonicalSchema.foreignKeys,
        usage_events: [
          {
            table: "worlds",
            from: "world_id",
            to: "uid",
            on_delete: "SET NULL",
          },
        ],
      },
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request("/ready", staleForeignKeySchema);

    expect(res.status).toBe(503);
  });

  it("keeps liveness separate and reports an unavailable database", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const readyRes = await request("/ready", {
      ...canonicalSchema,
      unavailable: true,
    });
    const healthRes = await request("/health", {
      ...canonicalSchema,
      unavailable: true,
    });

    expect(readyRes.status).toBe(503);
    expect(healthRes.status).toBe(200);
    await expect(healthRes.json()).resolves.toEqual({ status: "ok" });
    expect(log).toHaveBeenCalledOnce();
  });

  it("rejects nullable worlds.world_id", async () => {
    const nullableSchema: Schema = {
      ...canonicalSchema,
      columns: {
        ...canonicalSchema.columns,
        worlds: [{ name: "world_id", pk: 1, notnull: 0 }],
      },
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request("/ready", nullableSchema);

    expect(res.status).toBe(503);
  });

  it("rejects non-null usage_events.world_id", async () => {
    const nonNullSchema: Schema = {
      ...canonicalSchema,
      columns: {
        ...canonicalSchema.columns,
        usage_events: [{ name: "world_id", pk: 0, notnull: 1 }],
      },
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request("/ready", nonNullSchema);

    expect(res.status).toBe(503);
  });

  it("rejects world_limits lacking composite primary key", async () => {
    const compositeSchema: Schema = {
      ...canonicalSchema,
      columns: {
        ...canonicalSchema.columns,
        world_limits: [
          { name: "world_id", pk: 1, notnull: 1 },
          { name: "metric", pk: 0, notnull: 1 },
        ],
      },
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request("/ready", compositeSchema);

    expect(res.status).toBe(503);
  });
});
