export type Bindings = {
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  WAZOO_ENV?: string;
  API_BASE_URL?: string;
  WORLDS_API_URL: string;
  WORLDS_API_ADMIN_KEY: string;
  TURSO_ORG?: string;
  TURSO_GROUP?: string;
  TURSO_PLATFORM_API_TOKEN?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID?: string;
  RESEND_API_KEY?: string;
  OTP_FROM_ADDRESS?: string;
  WORKOS_API_KEY?: string;
  WORKOS_CLIENT_ID?: string;
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

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    auth: AuthContext;
  };
};
