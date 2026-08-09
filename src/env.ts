export type Bindings = {
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  WAZOO_ENV?: string;
  API_BASE_URL?: string;
  WORLDS_API_URL: string;
  WORLDS_API_ADMIN_KEY: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID?: string;
  RESEND_API_KEY?: string;
  OTP_FROM_ADDRESS?: string;
  WORKOS_API_KEY?: string;
  WORKOS_CLIENT_ID?: string;
  WAZOO_PLATFORM_ADMIN_TOKEN?: string;
  GOOGLE_SERVICE_ACCOUNT_KEY?: string;
  BETA_ALLOWLIST_SHEET_ID?: string;
};

export type AuthContext = {
  tokenId: string;
  userUid: string | null;
  scope: string;
  kind: "USER" | "ADMIN";
  expiresAt: string | null;
};

export function bindingsFromProcessEnv(): Bindings {
  const keys: (keyof Bindings)[] = [
    "TURSO_DATABASE_URL",
    "TURSO_AUTH_TOKEN",
    "WAZOO_ENV",
    "API_BASE_URL",
    "WORLDS_API_URL",
    "WORLDS_API_ADMIN_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_ID",
    "RESEND_API_KEY",
    "OTP_FROM_ADDRESS",
    "WORKOS_API_KEY",
    "WORKOS_CLIENT_ID",
    "WAZOO_PLATFORM_ADMIN_TOKEN",
    "GOOGLE_SERVICE_ACCOUNT_KEY",
    "BETA_ALLOWLIST_SHEET_ID",
  ];
  const env: Record<string, string | undefined> = {};
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env as Bindings;
}

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    auth: AuthContext;
  };
};
