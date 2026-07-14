export type Bindings = {
  DB: D1Database;
  API_BASE_URL?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID?: string;
};

export type AuthContext = {
  tokenId: string;
  organizationId: string | null;
  scope: string;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    auth: AuthContext;
  };
};
