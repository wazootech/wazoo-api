import { createClient, type InValue } from "@libsql/client/web";
import type { Bindings } from "../env";

export type Row = Record<string, unknown>;

export type PreparedStatement = BoundStatement & {
  bind(...args: unknown[]): BoundStatement;
};

export type BoundStatement = {
  all<T extends Row>(): Promise<{ results: T[] }>;
  first<T extends Row>(): Promise<T | null>;
  run(): Promise<void>;
};

export type Database = {
  prepare(sql: string): PreparedStatement;
  batch(statements: Array<{ sql: string; args?: unknown[] }>): Promise<void>;
};

export function db(env: Bindings): Database {
  const client = createClient({
    url: env.TURSO_DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN,
  });
  return {
    prepare(sql) {
      const bound = (...args: unknown[]): BoundStatement => {
        const statement = { sql, args: args as InValue[] };
        return {
          async all<T extends Row>() {
            const result = await client.execute(statement);
            return { results: result.rows as unknown as T[] };
          },
          async first<T extends Row>() {
            const result = await client.execute(statement);
            return (result.rows[0] as unknown as T | undefined) ?? null;
          },
          async run() {
            await client.execute(statement);
          },
        };
      };
      return {
        bind(...args) {
          return bound(...args);
        },
        all: bound().all,
        first: bound().first,
        run: bound().run,
      };
    },
    async batch(statements) {
      await client.batch(
        statements.map((statement) => ({
          sql: statement.sql,
          args: (statement.args ?? []) as InValue[],
        })),
        "write",
      );
    },
  };
}

export function id(): string {
  return crypto.randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}

export async function all<T extends Row>(
  statement: BoundStatement,
): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results ?? [];
}

export async function first<T extends Row>(
  statement: BoundStatement,
): Promise<T | null> {
  return statement.first<T>();
}

export type OrganizationRef = {
  uid: string;
  organizationId: string;
  displayName: string;
  state: string;
  deleteTime?: string | null;
  expireTime?: string | null;
};

export function resourceId(name: string, collection: string): string {
  return name.startsWith(`${collection}/`)
    ? name.slice(collection.length + 1)
    : name;
}

export async function organizationByIdentifier(
  db: Database,
  identifier: string,
): Promise<OrganizationRef | null> {
  return first<OrganizationRef>(
    db
      .prepare(
        "SELECT uid, organization_id AS organizationId, display_name AS displayName, state, delete_time AS deleteTime, expire_time AS expireTime FROM organizations WHERE organization_id = ?",
      )
      .bind(resourceId(identifier, "organizations")),
  );
}
