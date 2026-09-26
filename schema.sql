PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  state TEXT NOT NULL DEFAULT 'active',
  age_confirmed_at TEXT,
  create_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS worlds (
  world_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  slug TEXT,
  display_name TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'auto',
  state TEXT NOT NULL DEFAULT 'active',
  billing_provider TEXT NOT NULL DEFAULT 'STRIPE',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  billing_state TEXT NOT NULL DEFAULT 'BETA_FREE',
  delete_time TEXT,
  expire_time TEXT,
  purge_status TEXT NOT NULL DEFAULT 'none',
  create_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  update_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, slug)
);

CREATE TABLE IF NOT EXISTS platform_api_tokens (
  token_id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'USER',
  scope TEXT NOT NULL DEFAULT 'users.read worlds.read usage.read billing.read',
  last_used_at TEXT,
  expires_at TEXT,
  create_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (kind IN ('USER', 'ADMIN')),
  CHECK (kind != 'ADMIN' OR (user_id IS NULL AND instr(scope, 'admin') > 0))
);

CREATE TABLE IF NOT EXISTS usage_events (
  event_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  world_id TEXT REFERENCES worlds(world_id) ON DELETE SET NULL,
  metric TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit TEXT NOT NULL DEFAULT 'count',
  provider_cost_microcents INTEGER,
  wazoo_markup_microcents INTEGER NOT NULL DEFAULT 0,
  estimated_cost_microcents INTEGER,
  billing_source TEXT NOT NULL DEFAULT 'BETA_FREE',
  create_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS world_limits (
  world_id TEXT NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  limit_quantity INTEGER NOT NULL,
  create_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  update_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (world_id, metric)
);

CREATE TABLE IF NOT EXISTS beta_allowlist (
  email TEXT PRIMARY KEY,
  create_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS admin_audit_events (
  event_id TEXT PRIMARY KEY,
  actor_token_id TEXT,
  action TEXT NOT NULL,
  target_resource_name TEXT NOT NULL,
  outcome TEXT NOT NULL,
  error_code TEXT,
  create_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_worlds_user ON worlds(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_world_time ON usage_events(world_id, create_time);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS deletion_requests (
  deletion_request_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  create_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS rate_limit_entries (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  reset_at_ms INTEGER NOT NULL
);
