import { createClient } from "@libsql/client";
import type { Client, InStatement } from "@libsql/client";

export function createTestD1(dbPath: string): D1Database {
  const client = createClient({ url: `file:${dbPath}` });
  return {
    prepare(sql: string) {
      return createPrepared(client, sql);
    },
    async batch(statements: D1PreparedStatement[]) {
      const inputs = statements.map((statement) => {
        const candidate = statement as D1PreparedStatement & {
          __input?: InStatement | string;
        };
        if (!candidate.__input) {
          throw new Error("Test D1 statement was not bound");
        }
        return candidate.__input;
      });
      await client.batch(inputs as InStatement[]);
      return [];
    },
    async exec(sql: string) {
      await client.executeMultiple(sql);
    },
  } as unknown as D1Database;
}

function createPrepared(client: Client, sql: string): D1PreparedStatement {
  const statement = {
    bind(...args: unknown[]) {
      return createPreparedWithArgs(client, sql, args);
    },
    all: () => execute(client, sql),
    first: () => executeFirst(client, sql),
    run: () => executeRun(client, sql),
    __input: sql,
  } as unknown as D1PreparedStatement & { __input?: InStatement | string };
  return statement;
}

function createPreparedWithArgs(
  client: Client,
  sql: string,
  args: unknown[],
): D1PreparedStatement {
  const input = { sql, args } as InStatement;
  return {
    bind: (...nextArgs: unknown[]) =>
      createPreparedWithArgs(client, sql, nextArgs),
    all: () => execute(client, input),
    first: () => executeFirst(client, input),
    run: () => executeRun(client, input),
    __input: input,
  } as unknown as D1PreparedStatement;
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
  await client.execute(input);
  return { success: true, meta: { changes: 0 } };
}
