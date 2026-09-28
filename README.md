# Wazoo Platform API

Control-plane API for Wazoo. This repo owns the `api.wazoo.dev` Cloudflare Worker and the optional Docker image used by VPS compositions.

## Responsibility

- Users and platform API tokens.
- World metadata and lifecycle control.
- Per-world usage, limits, and billing records.
- Proxying world data-plane API-key creation to `worlds-api`.
- Deployment config for this one service: `wrangler.toml`, `Dockerfile`, `docker-compose.yml`, and CI.

`worlds-api` owns data storage/query/import/export/search. This service passes `namespace = user.id` when calling `worlds-api`; namespaces are an internal data-plane grouping, not a first-class platform resource.

## Routes

- Users: `GET /v1/users/me`
- Worlds: `/v1/worlds`, `/v1/worlds/:worldId`
- World API keys: `/v1/worlds/:worldId/auth/tokens`
- Usage: `/v1/worlds/:worldId/usage`
- Limits: `/v1/worlds/:worldId/limits`
- Billing stubs: `/v1/worlds/:worldId/billing`, `/v1/worlds/:worldId/billing/openPortal`, `/v1/stripe/webhook`

## Identity contract

Every public resource exposes `id`. Each D1 table uses an entity-specific key: `users.user_id`, `worlds.world_id`, `platform_api_tokens.token_id`, `usage_events.event_id`, `world_limits.world_limit_id`, `beta_allowlist.beta_allowlist_id`, `admin_audit_events.event_id`, `deletion_requests.request_id`, and `rate_limit_entries.rate_limit_entry_id`. Foreign keys use the referenced entity name, including `user_id`, `world_id`, and `actor_token_id`. `worlds-api` alone mints world IDs (`w_<UUIDv4>`) and exposes the value as `id`. Wazoo API accepts it only as the `worldId` route parameter and stores it in `world_id`. World creation takes a display name only; there is no slug, client-minted ID, or compatibility fallback.

- Platform API tokens: `/v1/auth/api-tokens`
- Health: `/health`
- OpenAPI-ish route list: `/openapi.json`

## Configuration

Required runtime variables:

- `DB`: Cloudflare D1 control-plane binding, configured by Wrangler.
- `WORLDS_API_URL`: data-plane API base URL.
- `WORLDS_API_ADMIN_KEY`: admin key accepted by `worlds-api`.
- `API_BASE_URL`: public base URL for this service.
- `WAZOO_ENV`: deployment environment label.
- `WAZOO_PLATFORM_ADMIN_TOKEN`: global admin token used by health checks and
  server-to-server admin calls. Must be seeded in the control-plane database.
  See [CONTRIBUTING.md](CONTRIBUTING.md) for how to generate and seed it. For D1, use `npm run launch:seed-admin-d1` with the Cloudflare credentials and target database ID.

D1 provisioning:

- For a new environment, create the database and apply `schema.sql`.
- The platform-ID cutover intentionally does not preserve existing rows. Its
  reset script drops every application-owned table; it leaves Cloudflare-managed
  tables untouched. Recreate the Wazoo API schema from `schema.sql`. The four
  targets are `worlds-api-qa`, `wazoo-api-qa`, `worlds-api`, and `wazoo-api`.
  Cut QA first, verify schema and end-to-end behavior, and repeat for production
  only after explicit approval. Confirm the Cloudflare account and exact database
  name before every reset. See `migrations/README.md` for the Wazoo API reset and
  the separate Worlds API reset file.
- Generate a fresh global admin token with `npm run launch:seed-admin-d1`.
  The database stores only its SHA-256 hash; save the printed plaintext only in
  the approved secret store and repository secret managers.

Optional Stripe variables:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID`

## Health checks

- Local: `npm run health:local`
- QA: `npm run health:beta`

Both require `WAZOO_PLATFORM_ADMIN_TOKEN` to be set. The scripts exercise the
full private-beta flow: user provisioning, world CRUD, token lifecycle, chunk
and quad import, search, SPARQL, usage/billing/limits, and soft delete. See
[CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions.

## Development

```sh
npm install
cp .dev.vars.example .dev.vars
npm run dev
npm run typecheck
```

The control plane uses Cloudflare D1. Apply `schema.sql` through the approved D1 deployment/provisioning process before serving traffic.

Platform tokens use the `wzp_` prefix. Global admin tokens must be manually seeded with `kind = 'ADMIN'`, `user_id = NULL`, and a scope containing `admin`.

Supported scopes include `users.read`, `users.write`, `worlds.read`, `worlds.write`, `worlds.admin`, `usage.read`, `billing.read`, and `admin`.

## Deployment

Cloudflare Worker:

```sh
npm run deploy:dry
npm run deploy
```

GitHub Actions validates formatting, typechecking, Worker dry deploy, Docker build, publishes the GHCR image on `main`, and deploys the configured Cloudflare Worker on `main`.

Docker Compose is not a supported runtime for this service because D1 is a
Cloudflare-managed binding. Use Wrangler for local development and D1 schema
initialization.
