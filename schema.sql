PRAGMA foreign_keys = ON;

CREATE TABLE organizations (
  uid TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'ACTIVE',
  quota_policy TEXT NOT NULL DEFAULT 'PRIVATE_BETA_DEFAULT',
  quota_reason TEXT,
  billing_provider TEXT NOT NULL DEFAULT 'STRIPE',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  billing_state TEXT NOT NULL DEFAULT 'BETA_FREE',
  delete_time TEXT,
  expire_time TEXT,
  purge_status TEXT NOT NULL DEFAULT 'none',
  purge_error TEXT,
  create_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  update_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE worlds (
  uid TEXT PRIMARY KEY,
  organization_uid TEXT NOT NULL REFERENCES organizations(uid) ON DELETE CASCADE,
  world_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'auto',
  state TEXT NOT NULL DEFAULT 'active',
  provisioning_state TEXT NOT NULL DEFAULT 'pending',
  provisioning_error TEXT,
  turso_database_name TEXT UNIQUE,
  turso_database_url TEXT,
  schema_version TEXT,
  durability_state TEXT NOT NULL DEFAULT 'not_configured',
  durability_error TEXT,
  delete_time TEXT,
  expire_time TEXT,
  purge_time TEXT,
  purge_status TEXT NOT NULL DEFAULT 'none',
  purge_error TEXT,
  create_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  update_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (organization_uid, world_id)
);

CREATE TABLE platform_api_tokens (
  uid TEXT PRIMARY KEY,
  organization_uid TEXT REFERENCES organizations(uid) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'ORGANIZATION',
  scope TEXT NOT NULL DEFAULT 'organizations.read worlds.read usage.read billing.read',
  last_used_at TEXT,
  expires_at TEXT,
  create_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (kind IN ('ORGANIZATION', 'ADMIN')),
  CHECK (kind != 'ADMIN' OR (organization_uid IS NULL AND instr(scope, 'admin') > 0))
);

CREATE TABLE world_auth_tokens (
  uid TEXT PRIMARY KEY,
  world_uid TEXT NOT NULL REFERENCES worlds(uid) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  last_used_at TEXT,
  expires_at TEXT,
  create_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE usage_events (
  uid TEXT PRIMARY KEY,
  organization_uid TEXT NOT NULL REFERENCES organizations(uid) ON DELETE CASCADE,
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

CREATE TABLE organization_limits (
  organization_uid TEXT NOT NULL REFERENCES organizations(uid) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  limit_quantity INTEGER NOT NULL,
  create_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  update_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (organization_uid, metric)
);

CREATE TABLE beta_applications (
  uid TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  applicant_name TEXT NOT NULL,
  company TEXT,
  use_case TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'PENDING',
  organization_uid TEXT REFERENCES organizations(uid) ON DELETE SET NULL,
  reviewer_token_uid TEXT,
  review_note TEXT,
  create_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  update_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  review_time TEXT,
  CHECK (state IN ('PENDING', 'APPROVED', 'REJECTED'))
);

CREATE TABLE admin_audit_events (
  uid TEXT PRIMARY KEY,
  actor_token_uid TEXT,
  action TEXT NOT NULL,
  target_resource_name TEXT NOT NULL,
  outcome TEXT NOT NULL,
  error_code TEXT,
  create_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_worlds_org ON worlds(organization_uid);
CREATE INDEX idx_world_tokens_world ON world_auth_tokens(world_uid);
CREATE INDEX idx_usage_org_time ON usage_events(organization_uid, create_time);
CREATE INDEX idx_beta_applications_state ON beta_applications(state, create_time);
CREATE UNIQUE INDEX idx_beta_applications_open_email ON beta_applications(lower(email)) WHERE state IN ('PENDING', 'APPROVED');
