# Production world-ID cutover (2026-10-10)

Record of the one-time production D1 migration for the canonical world-ID
contract (wazoo-api#63). Executed once; do not re-run.

## Why a migration and not a reset

QA was reset, but production holds real beta data, so it was migrated in
place. Only `worlds`, `usage_events` and `world_limits` differed from the
canonical schema (verified by diffing `sqlite_master` against QA, whose
`/ready` already passed). `users`, `platform_api_tokens` and every other table
were identical and were not touched.

## Preconditions (read-only, 2026-10-10)

- 28 users, 12 worlds (2 active, 10 deleted), 6 platform tokens.
- All 12 `world_id` values were distinct, non-null `w_<UUIDv4>`.
- `usage_events`, `world_limits`, `admin_audit_events` and deletion requests
  were empty; no Stripe subscriptions.
- None of the 12 worlds exists on the worlds-api production data plane, which
  was reset on 2026-10-05 (worlds-api#111). The 2 active worlds were already
  without data before this migration; they were kept as-is by decision.

## Execution

1. D1 Time Travel restore point: bookmark
   `0000003c-00000000-00005100-deb1eb4da104f3ec6ba6498abd6cb336`
   (2026-10-10T18:32:53Z).
2. Rehearsed on a local SQLite copy of production's DDL with 12 synthetic
   rows: no foreign-key violations, all IDs preserved, resulting schema
   identical to QA.
3. Applied `migrations/2026-10-10-prod-world-id-cutover.sql` at 18:33:39Z
   (one batch: 85 rows written).
4. Dispatched `deploy-prod` at 18:33:43Z (`3bb3ee1`); `/ready` returned 200 at
   18:34:33Z. Console `deploy-prod` followed (`b92c765`).

## Result

- `https://api.wazoo.dev/ready` and `https://data.wazoo.dev/ready`: 200
  `{"status":"ready"}`.
- Post-migration counts: 12 worlds (2 active), 28 users, 6 tokens; no
  temporary table left.
- Served OpenAPI: create takes `{ ownerEmail, email, world }`; `World` has
  `id`, no `uid`/`worldId`/`slug`.

## Rollback

`wrangler d1 time-travel restore wazoo-api --bookmark=<bookmark above>`, then
redeploy the pre-cutover wazoo-api. Only valid within the D1 Time Travel
retention window, and it discards any writes made after the bookmark.
