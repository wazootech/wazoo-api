import type { Database } from "./db";

type ColumnInfo = {
  name: string;
  pk: number;
};

type ForeignKeyInfo = {
  table: string;
  from: string;
  to: string;
  on_delete: string;
};

type ForeignKeyContract = {
  table: string;
  from: string;
  to: string;
  onDelete: string;
};

type TableContract = {
  columns: readonly string[];
  forbiddenColumns: readonly string[];
  primaryKey?: string;
  foreignKeys: readonly ForeignKeyContract[];
};

const WORLD_IDENTITY_SCHEMA: Record<string, TableContract> = {
  worlds: {
    columns: ["world_id", "user_uid", "display_name"],
    forbiddenColumns: ["uid", "worlds_api_uid", "slug"],
    primaryKey: "world_id",
    foreignKeys: [
      { table: "users", from: "user_uid", to: "uid", onDelete: "CASCADE" },
    ],
  },
  usage_events: {
    columns: ["world_id"],
    forbiddenColumns: ["world_uid"],
    foreignKeys: [
      {
        table: "worlds",
        from: "world_id",
        to: "world_id",
        onDelete: "SET NULL",
      },
    ],
  },
  world_limits: {
    columns: ["world_id"],
    forbiddenColumns: ["world_uid"],
    foreignKeys: [
      {
        table: "worlds",
        from: "world_id",
        to: "world_id",
        onDelete: "CASCADE",
      },
    ],
  },
};

export async function assertWorldIdentitySchema(
  database: Database,
): Promise<void> {
  for (const [table, contract] of Object.entries(WORLD_IDENTITY_SCHEMA)) {
    const { results: columns } = await database
      .prepare(`PRAGMA table_info('${table}')`)
      .all<ColumnInfo>();
    const names = new Set(columns.map((column) => column.name));
    const missing = contract.columns.filter((column) => !names.has(column));
    const forbidden = contract.forbiddenColumns.filter((column) =>
      names.has(column),
    );
    const details: string[] = [];

    if (columns.length === 0) details.push("table is missing");
    if (missing.length > 0)
      details.push(`missing columns: ${missing.join(", ")}`);
    if (forbidden.length > 0) {
      details.push(`legacy columns present: ${forbidden.join(", ")}`);
    }

    if (contract.primaryKey) {
      const primaryKeys = columns.filter((column) => Number(column.pk) > 0);
      if (
        primaryKeys.length !== 1 ||
        primaryKeys[0]?.name !== contract.primaryKey
      ) {
        const found =
          primaryKeys.map((column) => column.name).join(", ") || "none";
        details.push(
          `expected primary key ${contract.primaryKey}, found ${found}`,
        );
      }
    }

    const { results: foreignKeys } = await database
      .prepare(`PRAGMA foreign_key_list('${table}')`)
      .all<ForeignKeyInfo>();
    for (const expected of contract.foreignKeys) {
      const found = foreignKeys.some(
        (foreignKey) =>
          foreignKey.table === expected.table &&
          foreignKey.from === expected.from &&
          foreignKey.to === expected.to &&
          foreignKey.on_delete.toUpperCase() === expected.onDelete,
      );
      if (!found) {
        details.push(
          `missing foreign key ${expected.from} -> ${expected.table}.${expected.to} ON DELETE ${expected.onDelete}`,
        );
      }
    }

    if (details.length > 0) {
      throw new Error(
        `World identity schema mismatch for ${table}: ${details.join("; ")}`,
      );
    }
  }
}
