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

/** Returns the D1 binding from the worker environment. */
export function db(env: Bindings): Database {
  const d1 = env.DB;
  if (!d1) throw new Error("D1 database binding DB is required");
  return {
    prepare(sql) {
      const bound = (...args: unknown[]): BoundStatement => {
        const stmt = d1.prepare(sql).bind(...args);
        return {
          async all<T extends Row>() {
            const result = await stmt.all<T>();
            return { results: result.results ?? [] };
          },
          async first<T extends Row>() {
            return await stmt.first<T>();
          },
          async run() {
            await stmt.run();
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
      const stmts = statements.map((s) =>
        s.args && s.args.length > 0
          ? d1.prepare(s.sql).bind(...s.args)
          : d1.prepare(s.sql),
      );
      await d1.batch(stmts);
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
