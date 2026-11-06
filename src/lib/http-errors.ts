import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";
import type { AppEnv } from "../env";

export async function notFound() {
  throw new HTTPException(404, { message: "Not found" });
}

export async function errorHandler(error: Error, c: Context<AppEnv>) {
  if (error instanceof HTTPException) {
    return c.json(
      { error: { code: errorCode(error.status), message: error.message } },
      error.status,
    );
  }

  if (error instanceof SyntaxError) {
    return c.json(
      { error: { code: "INVALID_ARGUMENT", message: "Invalid JSON body" } },
      400,
    );
  }

  console.error(
    JSON.stringify({
      level: "error",
      message: error.message,
      stack: error.stack,
    }),
  );
  return c.json(
    { error: { code: "INTERNAL", message: "Internal server error" } },
    500,
  );
}

function errorCode(status: number): string {
  if (status === 400) return "INVALID_ARGUMENT";
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "PERMISSION_DENIED";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "ALREADY_EXISTS";
  if (status === 429) return "RESOURCE_EXHAUSTED";
  return "UNKNOWN";
}
