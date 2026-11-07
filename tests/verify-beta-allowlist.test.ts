import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import app from "../src/index";
import type { Bindings } from "../src/env";
import { clearAllowlistCache } from "../src/lib/beta-allowlist";
import { createTestD1 } from "./helpers/d1-test-adapter";

const authenticate = vi.fn(() => Promise.resolve({}));
vi.mock("@workos-inc/node", () => ({
  WorkOS: class {
    userManagement = { authenticateWithMagicAuth: authenticate };
  },
}));

// Fake fixtures only (memory#68).
const APPROVED = "approved@example.com";
const OUTSIDER = "outsider@example.com";
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

function stubSheets(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        url.startsWith("https://oauth2.googleapis.com/")
          ? new Response(
              JSON.stringify({ access_token: "t", expires_in: 3600 }),
            )
          : new Response(
              JSON.stringify({ values: [[APPROVED, "", "", "TRUE"]] }),
            ),
      ),
    ),
  );
}

describe("POST /v1/auth/verify enforces the beta allowlist (memory#68)", () => {
  let dir: string;
  let env: Bindings;

  const verify = (email: string) =>
    Promise.resolve(
      app.request(
        "/v1/auth/verify",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, code: "000000", ageConfirmed: true }),
        },
        env,
        ctx,
      ),
    );

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "wazoo-api-verify-allow-"));
    const dbPath = join(dir, "test.db");
    const client = new DatabaseSync(dbPath);
    client.exec(readFileSync(join(process.cwd(), "schema.sql"), "utf8"));
    client.close();
    env = {
      DB: createTestD1(dbPath),
      WORLDS_API_URL: "http://localhost:9999",
      WORLDS_API_ADMIN_KEY: "test",
      WAZOO_PLATFORM_ADMIN_TOKEN: "wzp_test-admin-token",
      WAZOO_ENV: "test",
      WORKOS_API_KEY: "fake-workos-key",
      WORKOS_CLIENT_ID: "fake-client",
      GOOGLE_SERVICE_ACCOUNT_KEY: JSON.stringify({
        client_email: "verify@test.iam.gserviceaccount.com",
        private_key: privateKey,
        project_id: "wazoo-test",
        type: "service_account",
      }),
    } as Bindings;
  });

  beforeEach(() => {
    clearAllowlistCache();
    authenticate.mockClear();
    stubSheets();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
    } catch {
      // Best-effort temp cleanup.
    }
  });

  it("refuses a valid code for a non-allowlisted email and creates no user", async () => {
    const res = await verify(OUTSIDER);
    expect(res.status).toBe(400);
    expect(authenticate).not.toHaveBeenCalled();
    const row = await env.DB.prepare("SELECT uid FROM users WHERE email = ?")
      .bind(OUTSIDER)
      .first();
    expect(row).toBeNull();
  });

  it("still mints a session for an allowlisted email", async () => {
    const res = await verify(APPROVED);
    expect(res.status).toBe(201);
    expect(authenticate).toHaveBeenCalledOnce();
  });

  it("fails closed when the allowlist cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("sheets down"))),
    );
    const res = await verify(APPROVED);
    expect(res.status).toBe(400);
    expect(authenticate).not.toHaveBeenCalled();
  });
});
