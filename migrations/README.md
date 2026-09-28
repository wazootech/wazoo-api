# Wazoo API D1 clean reset

This reset is destructive and does not preserve or translate rows. The SQL file in this directory applies only to the Wazoo API databases; do not run it against `worlds-api` or `worlds-api-qa`. The Worlds API has a separate reset file and schema initializer in its own repository.

## QA

Before running either command, verify the active Cloudflare account and the exact database name in `wrangler.toml`. Reset and explicitly recreate the Wazoo API schema:

```bash
npx wrangler d1 execute wazoo-api-qa --remote --file migrations/2026-09-27-platform-id-clean-reset.sql
npx wrangler d1 execute wazoo-api-qa --remote --file schema.sql
```

There is no deployment initializer that loads `schema.sql`. Do not deploy the cutover until both commands succeed and `PRAGMA table_info` confirms the entity-specific primary keys, `worlds.world_id`, and the absence of a slug column. Confirm `PRAGMA foreign_key_check` returns no rows, then run the QA health and end-to-end checks.

## Production

Apply the same two commands to `wazoo-api` only after QA passes and Ethan explicitly approves the destructive production reset and deployment. Never run this reset from CI, preview, or an automated release. The local SQLite reset tests do not verify remote D1 or deployed service behavior.
