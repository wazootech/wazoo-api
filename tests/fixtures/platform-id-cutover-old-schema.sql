PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  state TEXT NOT NULL DEFAULT 'active',
  age_confirmed_at TEXT,
  create_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS worlds (
  uid TEXT PRIMARY KEY,
  user_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  -- world_id is the canonical worlds-api identifier (w_<uuid>) and the routing
  -- key for /v1/worlds/{worldId} (wazoo-api#54).
  world_id TEXT NOT NULL,
  -- slug is the friendly, user-chosen alias. A label, never a routing key.
  slug TEXT,
  -- Vestigial: pre-rename holder of the canonical id. The migration backfills
  -- world_id from it and leaves it in place so the change stays reversible;
  -- dropping it needs a table rebuild, which cascades into usage_events and
  -- world_limits (verified destructive on 2026-09-25).
  worlds_api_uid TEXT,
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
  UNIQUE (user_uid, world_id)
);

CREATE TABLE IF NOT EXISTS platform_api_tokens (
  uid TEXT PRIMARY KEY,
  user_uid TEXT REFERENCES users(uid) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'USER',
  scope TEXT NOT NULL DEFAULT 'users.read worlds.read usage.read billing.read',
  last_used_at TEXT,
  expires_at TEXT,
  create_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (kind IN ('USER', 'ADMIN')),
  CHECK (kind != 'ADMIN' OR (user_uid IS NULL AND instr(scope, 'admin') > 0))
);

CREATE TABLE IF NOT EXISTS usage_events (
  uid TEXT PRIMARY KEY,
  user_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  -- world_uid is an internal FK to worlds.uid (the management row id).
  -- It is deliberately NOT the canonical world_id: see wazoo-api#56/#61.
  world_uid TEXT REFERENCES worlds(uid) ON DELETE SET NULL,
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
  world_uid TEXT NOT NULL REFERENCES worlds(uid) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  limit_quantity INTEGER NOT NULL,
  create_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  update_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (world_uid, metric)
);

CREATE TABLE IF NOT EXISTS beta_allowlist (
  email TEXT PRIMARY KEY,
  create_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS admin_audit_events (
  uid TEXT PRIMARY KEY,
  actor_token_uid TEXT,
  action TEXT NOT NULL,
  target_resource_name TEXT NOT NULL,
  outcome TEXT NOT NULL,
  error_code TEXT,
  create_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_worlds_user ON worlds(user_uid);
-- Slug uniqueness as an index rather than a table constraint: an index needs no
-- table rebuild, so the migration can never cascade into child tables.
CREATE UNIQUE INDEX IF NOT EXISTS idx_worlds_user_slug ON worlds(user_uid, slug);
CREATE INDEX IF NOT EXISTS idx_usage_world_time ON usage_events(world_uid, create_time);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- One row per pending account-deletion request. The confirmation token is
-- stored hashed (never plaintext) and short-lived; DELETE /v1/users/me
-- consumes it to complete the two-step erasure flow. User erasure is a hard
-- delete: FK cascades remove the user's worlds mirror rows, platform tokens,
-- and usage events, while worlds-api's namespace delete marks the underlying
-- per-world databases for the purge sweep.
CREATE TABLE IF NOT EXISTS deletion_requests (
  uid TEXT PRIMARY KEY,
  user_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  create_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS rate_limit_entries (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  reset_at_ms INTEGER NOT NULL
);

INSERT INTO users (uid, email, display_name, state, age_confirmed_at, create_time)
VALUES ('user_legacy_1', 'legacy@example.com', 'Legacy User', 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO worlds (
  uid, user_uid, world_id, slug, worlds_api_uid, display_name, region, state,
  billing_provider, stripe_customer_id, stripe_subscription_id, billing_state,
  delete_time, expire_time, purge_status, create_time, update_time
) VALUES (
  'world_record_legacy_1', 'user_legacy_1', 'w_canonical_1', 'legacy-world',
  'w_canonical_1', 'Legacy World', 'auto', 'active', 'STRIPE', 'cus_legacy',
  'sub_legacy', 'ACTIVE', NULL, NULL, 'none', '2026-01-02T00:00:00.000Z',
  '2026-01-03T00:00:00.000Z'
);

INSERT INTO platform_api_tokens (
  uid, user_uid, name, token_hash, kind, scope, last_used_at, expires_at, create_time
) VALUES (
  'token_legacy_1', 'user_legacy_1', 'legacy token', 'hash-token-1', 'USER',
  'users.read worlds.read', '2026-01-04T00:00:00.000Z', NULL,
  '2026-01-01T00:00:00.000Z'
);

INSERT INTO usage_events (
  uid, user_uid, world_uid, metric, quantity, unit, provider_cost_microcents,
  wazoo_markup_microcents, estimated_cost_microcents, billing_source, create_time
) VALUES
  ('event_legacy_world', 'user_legacy_1', 'world_record_legacy_1', 'QUERIES', 17, 'query', 101, 7, 108, 'STRIPE', '2026-01-05T00:00:00.000Z'),
  ('event_legacy_user', 'user_legacy_1', NULL, 'IMPORTS', 3, 'import', 20, 2, 22, 'BETA_FREE', '2026-01-06T00:00:00.000Z');

INSERT INTO world_limits (world_uid, metric, limit_quantity, create_time, update_time)
VALUES ('world_record_legacy_1', 'QUERIES', 500, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');

INSERT INTO beta_allowlist (email, create_time)
VALUES ('legacy@example.com', '2026-01-01T00:00:00.000Z');

INSERT INTO admin_audit_events (
  uid, actor_token_uid, action, target_resource_name, outcome, error_code, create_time
) VALUES (
  'audit_legacy_1', 'token_legacy_1', 'worlds.create', 'worlds/w_canonical_1',
  'SUCCESS', NULL, '2026-01-02T00:00:00.000Z'
);

INSERT INTO deletion_requests (uid, user_uid, token_hash, expires_at, create_time)
VALUES ('request_legacy_1', 'user_legacy_1', 'hash-deletion-1', '2026-01-10T00:00:00.000Z', '2026-01-09T00:00:00.000Z');

INSERT INTO rate_limit_entries (key, count, reset_at_ms)
VALUES ('login:ip:legacy', 2, 1770000000000);
