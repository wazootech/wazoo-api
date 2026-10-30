export type ColumnInfo = {
  name: string;
  pk: number;
  notnull?: number;
};

export type ForeignKeyInfo = {
  table: string;
  from: string;
  to: string;
  on_delete: string;
};

export type ForeignKeyContract = {
  table: string;
  from: string;
  to: string;
  onDelete: string;
};

export type TableContract = {
  columns: readonly string[];
  forbiddenColumns: readonly string[];
  primaryKeyColumns?: readonly string[];
  foreignKeys: readonly ForeignKeyContract[];
  notNullColumns?: readonly string[];
  nullableColumns?: readonly string[];
};

export const WORLD_IDENTITY_SCHEMA: Record<string, TableContract> = {
  worlds: {
    columns: ["world_id", "user_uid", "display_name"],
    forbiddenColumns: ["uid", "worlds_api_uid", "slug"],
    foreignKeys: [
      { table: "users", from: "user_uid", to: "uid", onDelete: "CASCADE" },
    ],
    primaryKeyColumns: ["world_id"],
    notNullColumns: ["world_id", "user_uid", "display_name"],
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
    nullableColumns: ["world_id"],
  },
  world_limits: {
    columns: ["world_id", "metric"],
    forbiddenColumns: ["world_uid"],
    foreignKeys: [
      {
        table: "worlds",
        from: "world_id",
        to: "world_id",
        onDelete: "CASCADE",
      },
    ],
    primaryKeyColumns: ["world_id", "metric"],
    notNullColumns: ["world_id", "metric"],
  },
};
