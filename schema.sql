PRAGMA foreign_keys = ON;

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'ACTIVE',
  quota_policy TEXT NOT NULL DEFAULT 'PRIVATE_BETA_DEFAULT',
  quota_reason TEXT,
  billing_provider TEXT NOT NULL DEFAULT 'STRIPE',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  billing_state TEXT NOT NULL DEFAULT 'BETA_FREE',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE worlds (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'auto',
  status TEXT NOT NULL DEFAULT 'active',
  provisioning_status TEXT NOT NULL DEFAULT 'pending',
  schema_version TEXT,
  durability_status TEXT NOT NULL DEFAULT 'not_configured',
  deleted_at TEXT,
  expire_at TEXT,
  purged_at TEXT,
  purge_status TEXT NOT NULL DEFAULT 'none',
  purge_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (organization_id, slug)
);

CREATE TABLE platform_api_tokens (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'ORGANIZATION',
  scope TEXT NOT NULL DEFAULT 'organizations.read worlds.read usage.read billing.read',
  last_used_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE world_auth_tokens (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  last_used_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE usage_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  world_id TEXT REFERENCES worlds(id) ON DELETE SET NULL,
  metric TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit TEXT NOT NULL DEFAULT 'count',
  provider_cost_microcents INTEGER,
  wazoo_markup_microcents INTEGER NOT NULL DEFAULT 0,
  estimated_cost_microcents INTEGER,
  billing_source TEXT NOT NULL DEFAULT 'BETA_FREE',
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE organization_limits (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  limit_quantity INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (organization_id, metric)
);

CREATE TABLE admin_audit_events (
  id TEXT PRIMARY KEY,
  actor_token_id TEXT,
  action TEXT NOT NULL,
  target_resource_name TEXT NOT NULL,
  outcome TEXT NOT NULL,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_worlds_org ON worlds(organization_id);
CREATE INDEX idx_world_tokens_world ON world_auth_tokens(world_id);
CREATE INDEX idx_usage_org_time ON usage_events(organization_id, occurred_at);
