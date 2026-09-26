# Migrations

Hand-applied D1 migrations, run with `wrangler d1 execute` against QA first,
then production. There is no migration runner. The world-identity and hard
identifier cutovers are ordered, one-time migrations and are not safe to rerun.

## 2026-09-25-world-id-canonical.sql

Promotes the canonical data-plane identifier to `world_id` and moves the
friendly value to `slug`. It is a prerequisite for the hard cutover below.
Its old identifier names are historical migration inputs, not live schema or
API names.

## 2026-09-26-entity-identifiers.sql

Apply this exactly once after the 2026-09-25 migration and before deploying the
matching Worker. It verifies canonical world IDs and old child relationships,
then remaps usage and limit world references from the old world row key to
`world_id`. It replaces `worlds` with `world_id` as the primary key and rebuilds
child tables with foreign keys to that key. User, token, usage-event,
audit-event, and deletion-request fields receive semantic IDs.

The migration stages child records before replacing the parent table so SQLite's
old `ON DELETE` actions cannot clear billing data. Legacy identifier names are
retained only as inputs in these one-time migration files and in the test-only
old-schema fixture `tests/fixtures/platform-id-cutover-old-schema.sql`. These
isolated upgrade artifacts remain P0 until the cutover is deployed and the
upgrade path is retired; none of the names may return to the live schema,
runtime, OpenAPI, clients, or current docs.

### Verification

`tests/platform-id-cutover-migration.test.ts` executes the migration against
`tests/fixtures/platform-id-cutover-old-schema.sql`, checks row/value and
relationship preservation, then runs `PRAGMA foreign_key_check` and verifies
cascade / `SET NULL` behavior on the new keys.
