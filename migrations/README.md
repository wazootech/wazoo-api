# Migrations

Hand-applied D1 migrations, run with `wrangler d1 execute` against the target
database (QA first, then prod). There is no migration runner; each file is
idempotent-safe to re-run and states its own preconditions.

For the active server-minted world identity contract and rollout sequence, see
[wazoo-api#63](https://github.com/wazootech/wazoo-api/issues/63) and
[wazootech/workspace#144](https://github.com/wazootech/workspace/issues/144).
The 2026-09-25 migration below is historical; it promotes a user-selected slug
and does not produce the current `w_<UUIDv4>` world ID. Do not treat it as a
step in the current cutover.

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

## 2026-09-29-world-id-global-unique.sql

Adds a global unique index on `worlds.world_id` so duplicate Worlds API IDs
produce HTTP 409 even if the existing row belongs to another user. Before
applying, verify the target has no duplicate IDs; do not repair or rewrite rows
as part of this migration:

```sql
SELECT world_id, COUNT(*) FROM worlds GROUP BY world_id HAVING COUNT(*) > 1;
```
