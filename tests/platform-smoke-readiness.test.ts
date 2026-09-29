import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

const smokeScript = fileURLToPath(
  new URL("../scripts/platform-smoke.mjs", import.meta.url),
);

type StubServer = {
  url: string;
  requests: string[];
  close: () => Promise<void>;
};

async function startServer(readyStatus: number): Promise<StubServer> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.url === "/ready") {
      response.statusCode = readyStatus;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({ status: readyStatus === 200 ? "ready" : "not_ready" }),
      );
      return;
    }
    response.statusCode = 500;
    response.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

async function runSmoke(apiUrl: string, worldsUrl: string) {
  return await new Promise<{ code: number | null; output: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [smokeScript], {
        env: {
          ...process.env,
          API_BASE_URL: apiUrl,
          WORLDS_API_URL: worldsUrl,
          CONSOLE_URL: "",
          WAZOO_PLATFORM_ADMIN_TOKEN: "test-only",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.setEncoding("utf8").on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.setEncoding("utf8").on("data", (chunk) => {
        output += chunk;
      });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, output }));
    },
  );
}

describe("QA platform smoke readiness gate", () => {
  it.each([
    { name: "Wazoo API", apiStatus: 503, worldsStatus: 200 },
    { name: "Worlds API", apiStatus: 200, worldsStatus: 503 },
  ])(
    "aborts before writes when $name is not ready",
    async ({ apiStatus, worldsStatus }) => {
      const api = await startServer(apiStatus);
      const worlds = await startServer(worldsStatus);

      try {
        const result = await runSmoke(api.url, worlds.url);

        expect(result.code).toBe(1);
        expect(result.output).toContain("aborted before writes");
        expect(api.requests).toEqual(["GET /ready"]);
        expect(worlds.requests).toEqual(
          apiStatus === 200 ? ["GET /ready"] : [],
        );
      } finally {
        await Promise.all([api.close(), worlds.close()]);
      }
    },
  );
  it("rejects production hosts before network requests", async () => {
    const worlds = await startServer(200);

    try {
      const result = await runSmoke("https://api.wazoo.dev", worlds.url);

      expect(result.code).toBe(1);
      expect(result.output).toContain("API_BASE_URL");
      expect(worlds.requests).toEqual([]);
    } finally {
      await worlds.close();
    }
  });
});
