import type { Database } from "./db";

import {
  WORLD_IDENTITY_SCHEMA,
  type ColumnInfo,
  type ForeignKeyInfo,
} from "./world-readiness-contract";

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

    if (contract.primaryKeyColumns) {
      const primaryKeys = columns.filter((column) => Number(column.pk) > 0);
      primaryKeys.sort((a, b) => Number(a.pk) - Number(b.pk));
      if (
        primaryKeys.length !== contract.primaryKeyColumns.length ||
        primaryKeys.map((column) => column.name).join(", ") !==
          contract.primaryKeyColumns.join(", ")
      ) {
        const found =
          primaryKeys.map((column) => column.name).join(", ") || "none";
        details.push(
          `expected primary key columns ${contract.primaryKeyColumns.join(", ")}, found ${found}`,
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

    if (contract.notNullColumns) {
      for (const column of contract.notNullColumns) {
        const columnInfo = columns.find((c) => c.name === column);
        if (!columnInfo || Number(columnInfo.notnull) !== 1) {
          details.push(
            `column ${column} should be NOT NULL but is ${
              columnInfo?.notnull ?? "null"
            }`,
          );
        }
      }
    }

    if (contract.nullableColumns) {
      for (const column of contract.nullableColumns) {
        const columnInfo = columns.find((c) => c.name === column);
        if (!columnInfo || Number(columnInfo.notnull) !== 0) {
          details.push(
            `column ${column} should be nullable but is ${
              columnInfo?.notnull ?? "null"
            }`,
          );
        }
      }
    }

    if (details.length > 0) {
      throw new Error(
        `World identity schema mismatch for ${table}: ${details.join("; ")}`,
      );
    }
  }
}
