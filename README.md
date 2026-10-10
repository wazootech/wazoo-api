# Wazoo Platform API

Control-plane API for Wazoo. This repo owns the `api.wazoo.dev` Cloudflare Worker and the optional Docker image used by VPS compositions.

## Responsibility

- Users and platform API tokens.
- World metadata and lifecycle control.
- Per-world usage, limits, and billing records.
- Proxying world data-plane API-key creation to `worlds-api`.
- Deployment config for this one service: `wrangler.toml`, `Dockerfile`, `docker-compose.yml`, and CI.

`worlds-api` owns data storage/query/import/export/search. This service passes `namespace = user.uid` when calling `worlds-api`; namespaces are an internal data-plane grouping, not a first-class platform resource.

## Routes

- Users: `GET /v1/users/me`
- Worlds: `/v1/worlds`, `/v1/worlds/:worldId`
- World API keys: `/v1/worlds/:worldId/auth/tokens`
- Usage: `/v1/worlds/:worldId/usage`
- Limits: `/v1/worlds/:worldId/limits`
- Billing stubs: `/v1/worlds/:worldId/billing`, `/v1/worlds/:worldId/billing/openPortal`, `/v1/stripe/webhook`

## World identity

`worlds-api` mints canonical world IDs in `w_<ULID>` form and returns each as
`id`. World creation accepts a display name, not a client-supplied ID or slug;
Wazoo API stores the returned ID in `worlds.world_id`, exposes it as
`world.id`, and uses it as the `worldId` path parameter for every world-scoped
route. The `worlds` table is keyed by `world_id`; its `user_uid` owner reference
continues to scope authorization.

- Platform API tokens: `/v1/auth/api-tokens`
- Liveness: `GET /health`
- World-schema readiness: `GET /ready`
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
  See [CONTRIBUTING.md](CONTRIBUTING.md) for how to generate and seed it. For D1, use `pnpm run launch:seed-admin-d1` with the Cloudflare credentials and target database ID.

D1 provisioning:

- The control-plane D1 database is created and bound by Wrangler configuration.
- Apply `schema.sql` before deploying a new environment.
- Generate a fresh global admin token with `pnpm run launch:seed-admin-d1`.
  The database stores only its SHA-256 hash; save the printed plaintext only in
  the approved secret store and repository secret managers.

Optional Stripe variables:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID`

## Health checks

- Local: `pnpm run health:local`
- QA: `pnpm run health:beta`

Both require `WAZOO_PLATFORM_ADMIN_TOKEN` to be set. They check `/ready` before
any world writes; the QA script checks readiness on both API services. `/health`
remains a liveness check and does not certify the schema. The scripts then
exercise the full private-beta flow: user provisioning, world CRUD, token
lifecycle, chunk and quad import, search, SPARQL, usage/billing/limits, and soft
delete. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions.

## Development

```sh
pnpm install
cp .dev.vars.example .dev.vars
pnpm run dev
pnpm run typecheck
```

The control plane uses Cloudflare D1. Apply `schema.sql` through the approved D1 deployment/provisioning process before serving traffic.

Platform tokens use the `wzp_` prefix. Global admin tokens must be manually seeded with `kind = 'ADMIN'`, `user_uid = NULL`, and a scope containing `admin`.

Supported scopes include `users.read`, `users.write`, `worlds.read`, `worlds.write`, `worlds.admin`, `usage.read`, `billing.read`, and `admin`.

## Deployment

Cloudflare Worker:

```sh
pnpm run deploy:dry
pnpm run deploy
```

GitHub Actions validates formatting, typechecking, Worker dry deploy, Docker build, publishes the GHCR image on `main`, and deploys the configured Cloudflare Worker on `main`.

Docker Compose is not a supported runtime for this service because D1 is a
Cloudflare-managed binding. Use Wrangler for local development and D1 schema
initialization.
