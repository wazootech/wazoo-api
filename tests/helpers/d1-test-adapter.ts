import { createClient } from "@libsql/client";
import type { Client, InStatement } from "@libsql/client";

export type TestD1 = D1Database & { path: string };

type BoundStatement = D1PreparedStatement & {
  __input?: InStatement | string;
};

export function createTestD1(dbPath: string): TestD1 {
  const client = createClient({ url: `file:${dbPath}` });
  const database = {
    prepare(sql: string) {
      return createPrepared(client, sql);
    },
    async batch(statements: D1PreparedStatement[]) {
      const inputs = statements.map((statement) => {
        const input = (statement as BoundStatement).__input;
        if (!input) throw new Error("Test D1 statement was not bound");
        return input;
      });
      await client.batch(inputs as InStatement[]);
      return [];
    },
    async exec(sql: string) {
      await client.executeMultiple(sql);
    },
  } as unknown as D1Database;

  return Object.assign(database, { path: dbPath }) as TestD1;
}

function createPrepared(client: Client, sql: string): BoundStatement {
  return {
    bind(...args: unknown[]) {
      return createPreparedWithArgs(client, sql, args);
    },
    all: () => execute(client, sql),
    first: () => executeFirst(client, sql),
    run: () => executeRun(client, sql),
    __input: sql,
  } as BoundStatement;
}

function createPreparedWithArgs(
  client: Client,
  sql: string,
  args: unknown[],
): BoundStatement {
  const input = { sql, args } as InStatement;
  return {
    bind: (...nextArgs: unknown[]) =>
      createPreparedWithArgs(client, sql, nextArgs),
    all: () => execute(client, input),
    first: () => executeFirst(client, input),
    run: () => executeRun(client, input),
    __input: input,
  } as BoundStatement;
}

async function execute(client: Client, input: string | InStatement) {
  const result = await client.execute(input);
  return { results: result.rows };
}

async function executeFirst<T = unknown>(
  client: Client,
  input: string | InStatement,
): Promise<T | null> {
  const result = await client.execute(input);
  return (result.rows[0] as T | undefined) ?? null;
}

async function executeRun(client: Client, input: string | InStatement) {
  const result = await client.execute(input);
  return { success: true, meta: { changes: result.rowsAffected } };
}
