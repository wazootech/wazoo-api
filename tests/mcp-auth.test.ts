import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canReadWorld } from "../src/routes/mcp";
import type { Bindings } from "../src/env";
import { createTestD1, type TestD1 } from "./helpers/d1-test-adapter";

const worldId = "w_00000000-0000-4000-8000-000000000001";
const envBindings = {
  WORLDS_API_URL: "https://data.example.test",
  WORLDS_API_ADMIN_KEY: "test-key",
} as unknown as Bindings;

let dir: string;
let database: TestD1;
const access = (userId: string | null, admin = false) => ({
  env: { ...envBindings, DB: database },
  userId,
  admin,
});

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "wazoo-api-mcp-auth-"));
  const dbPath = join(dir, "test.db");
  const setup = new DatabaseSync(dbPath);
  setup.exec(readFileSync(join(process.cwd(), "schema.sql"), "utf8"));
  setup
    .prepare("INSERT INTO users (user_id, email) VALUES (?, ?)")
    .run("owner-1", "owner@example.com");
  setup
    .prepare(
      "INSERT INTO worlds (world_id, user_id, display_name) VALUES (?, ?, ?)",
    )
    .run(worldId, "owner-1", "Private world");
  setup
    .prepare(
      "INSERT INTO worlds (world_id, user_id, display_name, state) VALUES (?, ?, ?, ?)",
    )
    .run(
      "w_00000000-0000-4000-8000-000000000002",
      "owner-1",
      "Deleted",
      "deleted",
    );
  setup.close();
  database = createTestD1(dbPath);
});

afterAll(() => {
  database.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("MCP world authorization", () => {
  it("allows only the owning user to access an active world", async () => {
    expect(await canReadWorld(access("owner-1"), worldId)).toBe(true);
    expect(await canReadWorld(access("other-user"), worldId)).toBe(false);
    expect(await canReadWorld(access(null), worldId)).toBe(false);
  });

  it("allows an admin and rejects invalid or deleted world IDs", async () => {
    expect(await canReadWorld(access(null, true), worldId)).toBe(true);
    expect(await canReadWorld(access("owner-1"), "not-a-world-id")).toBe(false);
    expect(
      await canReadWorld(
        access("owner-1"),
        "w_00000000-0000-4000-8000-000000000002",
      ),
    ).toBe(false);
  });
});
