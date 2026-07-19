import { createClient, type InValue } from "@libsql/client";
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

export type UserRef = {
  uid: string;
  email: string;
  displayName?: string | null;
  state: string;
};

export function resourceId(name: string, collection: string): string {
  return name.startsWith(`${collection}/`)
    ? name.slice(collection.length + 1)
    : name;
}

export async function userByIdentifier(
  db: Database,
  identifier: string,
): Promise<UserRef | null> {
  return first<UserRef>(
    db
      .prepare(
        "SELECT uid, email, display_name AS displayName, state FROM users WHERE uid = ? OR email = ?",
      )
      .bind(resourceId(identifier, "users"), identifier.toLowerCase()),
  );
}
