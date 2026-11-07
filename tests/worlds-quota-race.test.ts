import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { TestD1 } from "./helpers/d1-test-adapter";
import {
  api,
  requestFromCall,
  TEST_EMAIL,
  useWorldsHarness,
} from "./helpers/worlds-harness";

// wazoo-api#150: parallel creates at 9/10 must not exceed maxWorlds.
describe("concurrent POST /v1/worlds respects maxWorlds (wazoo-api#150)", () => {
  const h = useWorldsHarness();

  function withDb<T>(fn: (db: DatabaseSync) => T): T {
    const db = new DatabaseSync((h.env.DB as TestD1).path);
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }

  function activeCount(): number {
    return withDb(
      (db) =>
        db
          .prepare("SELECT COUNT(*) AS n FROM worlds WHERE state != 'deleted'")
          .get() as { n: number },
    ).n;
  }

  function seedWorlds(count: number) {
    withDb((db) => {
      const user = db
        .prepare("SELECT uid FROM users WHERE email = ?")
        .get(TEST_EMAIL) as { uid: string };
      db.exec("DELETE FROM worlds");
      for (let i = 0; i < count; i++) {
        db.prepare(
          "INSERT INTO worlds (world_id, user_uid, display_name) VALUES (?, ?, ?)",
        ).run(`w_seed${String(i).padStart(22, "0")}`, user.uid, `Seed ${i}`);
      }
    });
  }

  /** Parks every request at key minting (after its quota check) until n arrive. */
  function holdKeyMintUntil(n: number) {
    const fallback = h.worldsApiMock.getMockImplementation() as (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => Response;
    let arrived = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    h.worldsApiMock.mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = requestFromCall(input, init);
        if (req.url.endsWith("/api-keys") && req.method === "POST") {
          if (++arrived >= n) release();
          await gate;
        }
        return fallback(input, init);
      },
    );
  }

  function create(i: number) {
    return api(
      "/v1/worlds",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${h.sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ world: { displayName: `Racer ${i}` } }),
      },
      h.env,
    );
  }

  it("admits exactly one of five parallel creates at 9 of 10", async () => {
    seedWorlds(9);
    holdKeyMintUntil(5);
    const responses = await Promise.all([0, 1, 2, 3, 4].map(create));
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 429, 429, 429, 429]);
    expect(activeCount()).toBe(10);
    // Each rejected create undoes its worlds-api world.
    const deletes = h.worldsApiMock.mock.calls.filter(
      ([input, init]) => requestFromCall(input, init).method === "DELETE",
    );
    expect(deletes.length).toBe(8); // 4 worlds + 4 minted keys
    const rejected = responses.find((r) => r.status === 429)!;
    const body = (await rejected.json()) as {
      error: { code: string };
      quota: { state: string };
    };
    expect(body.error.code).toBe("RESOURCE_EXHAUSTED");
    expect(body.quota.state).toBe("THROTTLED");
  });

  it("still creates below the cap", async () => {
    seedWorlds(3);
    expect((await create(1)).status).toBe(201);
    expect(activeCount()).toBe(4);
  });
});
