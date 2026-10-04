# Migrations

Hand-applied D1 migrations, run with `wrangler d1 execute` against the target
database (QA first, then prod). There is no migration runner; each file is
idempotent-safe to re-run and states its own preconditions.

## 2026-09-25-world-id-canonical.sql

Makes `world_id` the canonical data-plane identifier (`w_<uuid>`) and moves the
friendly user-chosen id into `slug`, matching `wazoo-api#54` (canonical-only
routing) and `wazoo-api#58` (worlds table transition).

**Run this before deploying the code that ships with it.** The new code reads
`world_id` as canonical, so a deploy without the migration would pass a slug to
the data plane and 404 every world-scoped call.

The migration does **not** drop `worlds_api_uid`. It is kept as a vestigial,
reversible copy of the promotion source:

- SQLite performs `ON DELETE CASCADE` actions when a parent table is dropped,
  even under `PRAGMA defer_foreign_keys`. The textbook table rebuild (which is
  the only way to drop a column referenced by the table's `UNIQUE` constraint)
  silently deleted `world_limits` rows and nulled `usage_events.world_uid` in a
  local rehearsal — live billing data. Rehearsed and rejected.
- Keeping the column makes rollback a one-liner:
  `UPDATE worlds SET world_id = slug;`

Dropping it later is tracked separately and needs a rebuild that runs with
foreign keys disabled, which D1 does not currently expose.

### Verified

Rehearsed against the pre-migration schema with child rows present
(1 `usage_events` row, 1 `world_limits` row): both preserved, zero rows nulled,
zero `PRAGMA foreign_key_check` violations, and a world with a NULL
`worlds_api_uid` keeps its existing `world_id` while gaining a matching `slug`.

## 2026-09-28-world-id-global-unique.sql

Adds a unique index on `worlds.world_id`. Worlds API IDs are minted globally;
this lets the API return HTTP 409 if a duplicate ID is ever returned, even
when the existing row belongs to a different user. The migration only adds an
index and does not rebuild tables or alter child-row references. Check for
pre-existing duplicates before applying with:

```sql
SELECT world_id, COUNT(*) FROM worlds GROUP BY world_id HAVING COUNT(*) > 1;
```
