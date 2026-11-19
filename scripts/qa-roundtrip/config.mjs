// Environment parsing for the QA round trip (wazoo-api#149). Same variables,
// validation errors and defaults as before; extracted so the driver and the
// scenario modules stay under the file-length limit.
import { MOCK } from "../lib/mode.mjs";

const MODELS = {
  openai: "openai/text-embedding-3-small",
  openrouter: "openrouter/openai/text-embedding-3-small",
};

export function loadConfig() {
  const API = "https://api-qa.wazoo.dev";
  const DATA = "https://data-qa.wazoo.dev";
  const ADMIN = MOCK
    ? "mock-admin-token"
    : (process.env.WAZOO_PLATFORM_ADMIN_TOKEN ??
      (() => {
        throw new Error("WAZOO_PLATFORM_ADMIN_TOKEN missing");
      })());

  // BYOK embeddings acceptance (worlds-api#1, design section 6). Off unless
  // explicitly requested: without a provider key and a KEK on the target
  // worlds-api (BYOK has no mode switch), search is keyword-only, so the hybrid
  // assertions below would fail by design. The default round trip is unchanged.
  //   WAZOO_EMBEDDINGS_ACCEPTANCE=1  run the hybrid acceptance block
  //   WAZOO_EMBEDDINGS_PROVIDER      openai (default) or openrouter
  //   WAZOO_EMBEDDINGS_PROVIDER_KEY  a key for that provider: a personal ephemeral
  //                                  one, or the capped QA OpenAI key in /ci
  //   WORLDS_API_ADMIN_KEY           data-plane admin key (Infisical qa)
  const HYBRID = process.env.WAZOO_EMBEDDINGS_ACCEPTANCE === "1";
  const DATA_ADMIN = process.env.WORLDS_API_ADMIN_KEY;
  const PROVIDER_KEY = process.env.WAZOO_EMBEDDINGS_PROVIDER_KEY;
  const PROVIDER = process.env.WAZOO_EMBEDDINGS_PROVIDER ?? "openai";
  const EMBEDDING_MODEL = MODELS[PROVIDER];
  if (HYBRID && !EMBEDDING_MODEL) {
    throw new Error(
      `WAZOO_EMBEDDINGS_PROVIDER must be one of ${Object.keys(MODELS).join(", ")}`,
    );
  }
  if (HYBRID && (!DATA_ADMIN || !PROVIDER_KEY)) {
    throw new Error(
      "WAZOO_EMBEDDINGS_ACCEPTANCE=1 needs WORLDS_API_ADMIN_KEY and WAZOO_EMBEDDINGS_PROVIDER_KEY",
    );
  }
  return {
    API,
    DATA,
    ADMIN,
    HYBRID,
    DATA_ADMIN,
    PROVIDER_KEY,
    EMBEDDING_MODEL,
    CREDENTIAL_PATH: `/v1/users/me/embedding-providers/${PROVIDER}`,
  };
}
