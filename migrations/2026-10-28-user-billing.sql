-- Links a user to their Stripe customer and subscription, and records which
-- Stripe events were already applied. The Pro plan follows the subscription.
--
-- Precondition: 2026-10-27-user-plan.sql has been applied (users.plan exists).
-- Run once per database (QA first, then prod). SQLite has no ADD COLUMN IF NOT
-- EXISTS: a "duplicate column name" error means that statement was already
-- applied; run the remaining statements one by one.
--
-- Deploy order: run this BEFORE deploying the code that reads these columns.
-- Until it runs, plan reads still work (billing shows as unavailable) but a
-- Stripe webhook cannot be applied.
ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT;
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);
CREATE TABLE IF NOT EXISTS stripe_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  create_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
