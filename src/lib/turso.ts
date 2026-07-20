import { HTTPException } from "hono/http-exception";
import type { Bindings } from "../env";

type CreateDatabaseResponse = {
  database?: {
    Hostname?: string;
    hostname?: string;
    Name?: string;
    name?: string;
  };
  error?: string;
};

type CreateTokenResponse = {
  jwt?: string;
  error?: string;
};

export type ProvisionedWorldDatabase = {
  name: string;
  url: string;
  authToken: string;
};

export async function provisionWorldDatabase(
  env: Bindings,
  worldUid: string,
): Promise<ProvisionedWorldDatabase> {
  const org = env.TURSO_ORG;
  const group = env.TURSO_GROUP;
  const token = env.TURSO_PLATFORM_API_TOKEN;
  if (!org || !group || !token) {
    throw new HTTPException(500, {
      message: "Turso provisioning is not configured",
    });
  }

  const name = databaseName(env.WAZOO_ENV ?? "prod", worldUid);
  const database = await turso<CreateDatabaseResponse>(
    env,
    `/v1/organizations/${encodeURIComponent(org)}/databases`,
    {
      method: "POST",
      body: { name, group },
      allowConflict: true,
    },
  );
  const hostname = database.database?.Hostname ?? database.database?.hostname;
  const url = hostname ? `libsql://${hostname}` : await databaseUrl(env, name);

  const auth = await turso<CreateTokenResponse>(
    env,
    `/v1/organizations/${encodeURIComponent(org)}/databases/${encodeURIComponent(name)}/auth/tokens?authorization=full-access&expiration=never`,
    { method: "POST" },
  );
  if (!auth.jwt) {
    throw new HTTPException(502, {
      message: "Turso did not return a database auth token",
    });
  }
  return { name, url, authToken: auth.jwt };
}

async function databaseUrl(env: Bindings, name: string): Promise<string> {
  const org = env.TURSO_ORG!;
  const response = await turso<CreateDatabaseResponse>(
    env,
    `/v1/organizations/${encodeURIComponent(org)}/databases/${encodeURIComponent(name)}`,
    { method: "GET" },
  );
  const hostname = response.database?.Hostname ?? response.database?.hostname;
  if (!hostname) {
    throw new HTTPException(502, {
      message: "Turso did not return a database hostname",
    });
  }
  return `libsql://${hostname}`;
}

async function turso<T>(
  env: Bindings,
  path: string,
  options: {
    method: "GET" | "POST" | "DELETE";
    body?: unknown;
    allowConflict?: boolean;
  },
): Promise<T> {
  const response = await fetch(`https://api.turso.tech${path}`, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${env.TURSO_PLATFORM_API_TOKEN}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const body = text
    ? (JSON.parse(text) as T & { error?: string })
    : ({} as T & { error?: string });
  if (!response.ok && !(options.allowConflict && response.status === 409)) {
    throw new HTTPException(502, {
      message: body.error ?? `Turso API returned ${response.status}`,
    });
  }
  return body;
}

function databaseName(envName: string, worldUid: string): string {
  return `wz-${envName}-${worldUid}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
