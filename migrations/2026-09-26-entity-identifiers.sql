-- One-time upgrade from the post-2026-09-25 schema for wazoo-api#63.
-- Apply 2026-09-25-world-id-canonical.sql first, then apply this before deploying the matching Worker.
-- Legacy identifier names occur here only as source columns in this data-preserving migration.

CREATE TABLE entity_identifier_cutover_check (
  valid INTEGER NOT NULL CHECK (valid = 1)
);

INSERT INTO entity_identifier_cutover_check (valid)
SELECT CASE
  WHEN NOT EXISTS (
    SELECT 1 FROM worlds
    WHERE world_id IS NULL OR world_id = ''
  )
  AND NOT EXISTS (
    SELECT world_id FROM worlds GROUP BY world_id HAVING COUNT(*) > 1
  )
  AND NOT EXISTS (
    SELECT 1 FROM worlds
    WHERE worlds_api_uid IS NOT NULL
      AND worlds_api_uid <> ''
      AND worlds_api_uid <> world_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM usage_events AS events
    LEFT JOIN worlds ON worlds.uid = events.world_uid
    WHERE events.world_uid IS NOT NULL AND worlds.uid IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM world_limits AS limits
    LEFT JOIN worlds ON worlds.uid = limits.world_uid
    WHERE worlds.uid IS NULL
  )
  THEN 1
  ELSE 0
END;

DROP TABLE entity_identifier_cutover_check;

ALTER TABLE users RENAME COLUMN uid TO user_id;
ALTER TABLE worlds RENAME COLUMN user_uid TO user_id;
ALTER TABLE platform_api_tokens RENAME COLUMN uid TO token_id;
ALTER TABLE platform_api_tokens RENAME COLUMN user_uid TO user_id;
ALTER TABLE usage_events RENAME COLUMN uid TO event_id;
ALTER TABLE usage_events RENAME COLUMN user_uid TO user_id;
ALTER TABLE deletion_requests RENAME COLUMN uid TO deletion_request_id;
ALTER TABLE deletion_requests RENAME COLUMN user_uid TO user_id;
ALTER TABLE admin_audit_events RENAME COLUMN uid TO event_id;
ALTER TABLE admin_audit_events RENAME COLUMN actor_token_uid TO actor_token_id;

CREATE TABLE usage_events_entity_cutover AS
SELECT
  events.event_id,
  events.user_id,
  worlds.world_id,
  events.metric,
  events.quantity,
  events.unit,
  events.provider_cost_microcents,
  events.wazoo_markup_microcents,
  events.estimated_cost_microcents,
  events.billing_source,
  events.create_time
FROM usage_events AS events
LEFT JOIN worlds ON worlds.uid = events.world_uid;

CREATE TABLE world_limits_entity_cutover AS
SELECT
  worlds.world_id,
  limits.metric,
  limits.limit_quantity,
  limits.create_time,
  limits.update_time
FROM world_limits AS limits
LEFT JOIN worlds ON worlds.uid = limits.world_uid;

DROP TABLE usage_events;
DROP TABLE world_limits;

CREATE TABLE worlds_replacement (
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

INSERT INTO worlds_replacement (
  world_id,
  user_id,
  slug,
  display_name,
  region,
  state,
  billing_provider,
  stripe_customer_id,
  stripe_subscription_id,
  billing_state,
  delete_time,
  expire_time,
  purge_status,
  create_time,
  update_time
)
SELECT
  world_id,
  user_id,
  slug,
  display_name,
  region,
  state,
  billing_provider,
  stripe_customer_id,
  stripe_subscription_id,
  billing_state,
  delete_time,
  expire_time,
  purge_status,
  create_time,
  update_time
FROM worlds;

DROP TABLE worlds;
ALTER TABLE worlds_replacement RENAME TO worlds;

CREATE TABLE usage_events (
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

INSERT INTO usage_events (
  event_id,
  user_id,
  world_id,
  metric,
  quantity,
  unit,
  provider_cost_microcents,
  wazoo_markup_microcents,
  estimated_cost_microcents,
  billing_source,
  create_time
)
SELECT
  event_id,
  user_id,
  world_id,
  metric,
  quantity,
  unit,
  provider_cost_microcents,
  wazoo_markup_microcents,
  estimated_cost_microcents,
  billing_source,
  create_time
FROM usage_events_entity_cutover;

CREATE TABLE world_limits (
  world_id TEXT NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  limit_quantity INTEGER NOT NULL,
  create_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  update_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (world_id, metric)
);

INSERT INTO world_limits (
  world_id,
  metric,
  limit_quantity,
  create_time,
  update_time
)
SELECT world_id, metric, limit_quantity, create_time, update_time
FROM world_limits_entity_cutover;

DROP TABLE usage_events_entity_cutover;
DROP TABLE world_limits_entity_cutover;

CREATE INDEX idx_worlds_user ON worlds(user_id);
CREATE UNIQUE INDEX idx_worlds_user_slug ON worlds(user_id, slug);
CREATE INDEX idx_usage_world_time ON usage_events(world_id, create_time);
