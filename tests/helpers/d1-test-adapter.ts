import { DatabaseSync } from "node:sqlite";

export type TestD1 = D1Database & { path: string; close(): void };

type SqliteValue = string | number | bigint | Uint8Array | null;
type SqlInput = { sql: string; args: SqliteValue[] } | string;
type BoundStatement = D1PreparedStatement & { __input?: SqlInput };

export function createTestD1(dbPath: string): TestD1 {
  const db = new DatabaseSync(dbPath, { allowExtension: true });
  const database = {
    prepare(sql: string) {
      return createPrepared(db, sql);
    },
    async batch(statements: D1PreparedStatement[]) {
      const inputs = statements.map((statement) => {
        const input = (statement as BoundStatement).__input;
        if (!input) throw new Error("Test D1 statement was not bound");
        return input;
      });
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const input of inputs) executeRun(db, input);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return [];
    },
    async exec(sql: string) {
      db.exec(sql);
    },
  } as unknown as D1Database;

  return Object.assign(database, {
    path: dbPath,
    close: () => db.close(),
  }) as TestD1;
}

function createPrepared(db: DatabaseSync, sql: string): BoundStatement {
  return {
    bind(...args: SqliteValue[]) {
      return createPreparedWithArgs(db, sql, args);
    },
    all: () => executeAll(db, sql),
    first: () => executeFirst(db, sql),
    run: () => executeRun(db, sql),
    __input: sql,
  } as unknown as BoundStatement;
}

function createPreparedWithArgs(
  db: DatabaseSync,
  sql: string,
  args: SqliteValue[],
): BoundStatement {
  const input = { sql, args };
  return {
    bind: (...nextArgs: SqliteValue[]) =>
      createPreparedWithArgs(db, sql, nextArgs),
    all: () => executeAll(db, input),
    first: () => executeFirst(db, input),
    run: () => executeRun(db, input),
    __input: input,
  } as unknown as BoundStatement;
}

function normalize(input: SqlInput): { sql: string; args: SqliteValue[] } {
  return typeof input === "string" ? { sql: input, args: [] } : input;
}

function executeAll(db: DatabaseSync, input: SqlInput) {
  const { sql, args } = normalize(input);
  return { results: db.prepare(sql).all(...args) };
}

function executeFirst<T = unknown>(
  db: DatabaseSync,
  input: SqlInput,
): T | null {
  const rows = executeAll(db, input).results;
  return (rows[0] as T | undefined) ?? null;
}

function executeRun(db: DatabaseSync, input: SqlInput) {
  const { sql, args } = normalize(input);
  const result = db.prepare(sql).run(...args);
  return {
    success: true,
    meta: {
      changes: Number(result.changes),
      last_row_id: Number(result.lastInsertRowid),
    },
  };
}
