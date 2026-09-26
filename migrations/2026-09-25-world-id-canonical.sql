-- world_id canonicalization for wazoo-api (wazootech/wazoo-api#58, executes #52).
--
-- Before: worlds.world_id held the friendly slug; worlds.worlds_api_uid held the
--         canonical data-plane id (w_<uuid>).
-- After:  worlds.world_id holds the canonical id and is the routing key for
--         /v1/worlds/{worldId}; worlds.slug holds the friendly alias.
--
-- worlds_api_uid is kept, vestigial. That is what makes this migration
-- reversible: the previous world_id values are preserved in slug, and the
-- canonical copies remain in worlds_api_uid.
--
-- Deliberately no table rebuild. Dropping worlds_api_uid is only possible via a
-- worlds-table rebuild, and `DROP TABLE worlds` fires ON DELETE CASCADE / SET
-- NULL into usage_events and world_limits, destroying live billing rows. That
-- was measured destructive on 2026-09-25 against a copy of the old shape.
--
-- Ordering: run this BEFORE deploying the Worker that reads the new shape. The
-- new code resolves /v1/worlds/{worldId} against worlds.world_id and passes it
-- to the data plane, so an unmigrated database answers with slugs and the data
-- plane 404s.

ALTER TABLE worlds ADD COLUMN slug TEXT;

UPDATE worlds SET slug = world_id WHERE slug IS NULL;

UPDATE worlds SET world_id = worlds_api_uid
  WHERE worlds_api_uid IS NOT NULL AND worlds_api_uid <> '';

-- Slug uniqueness as an index, not a table constraint, for the same reason:
-- an index needs no rebuild of `worlds`.
CREATE UNIQUE INDEX IF NOT EXISTS idx_worlds_user_slug ON worlds(user_uid, slug);
