# Migrations

Apply D1 migrations manually with `wrangler d1 execute`, QA first and then production. There is no migration runner. Each migration states its preconditions; never assume a hand-applied migration is safe to rerun.

## 2026-09-26-entity-identifiers.sql

This one-time, data-preserving cutover follows `2026-09-25-world-id-canonical.sql` and must run before deploying the matching Worker. It rebuilds the world table so `world_id` becomes the primary key and every world foreign key targets it. It also renames all other entity keys to semantic names, including user, platform-token, usage-event, deletion-request, and audit-event identifiers.

The SQL necessarily reads the previous column names as migration inputs; it does not retain compatibility columns or expose those names in the resulting schema or API. The migration checks canonical IDs before changing tables, stages usage and limit records before replacing the parent table, and preserves each record's IDs, values, and world relationship. It is a one-time upgrade and is not safe to retry after partial execution; inspect the database before attempting recovery.

Before deployment, rehearse the migration against a copy of the pre-cutover schema and data, then verify row counts and `PRAGMA foreign_key_check`. Do not deploy the new Worker until the migration has succeeded in the target environment.

## 2026-09-25-world-id-canonical.sql

This earlier migration promoted the data-plane key to `world_id` and moved the friendly world name into `slug`. It is a required first step for the entity-identifier migration above. Its retained staging column exists only to support that upgrade path; it is removed by the subsequent one-time cutover.
