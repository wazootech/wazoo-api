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
