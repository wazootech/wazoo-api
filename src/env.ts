export type Bindings = {
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  TURSO_PLATFORM_API_TOKEN?: string;
  TURSO_ORGANIZATION_SLUG?: string;
  TURSO_GROUP?: string;
  WAZOO_ENV?: string;
  API_BASE_URL?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID?: string;
};

export type AuthContext = {
  tokenId: string;
  organizationId: string | null;
  scope: string;
  kind: "ORGANIZATION" | "ADMIN";
  expiresAt: string | null;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    auth: AuthContext;
  };
};
