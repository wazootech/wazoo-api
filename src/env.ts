export type Bindings = {
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  API_BASE_URL?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID?: string;
};

export type AuthContext = {
  tokenId: string;
  organizationId: string | null;
  scope: string;
  expiresAt: string | null;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    auth: AuthContext;
  };
};
