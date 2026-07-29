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
- Platform API tokens: `/v1/auth/api-tokens`
- Health: `/health`
- OpenAPI-ish route list: `/openapi.json`

## Configuration

Required runtime variables:

- `TURSO_DATABASE_URL`: control-plane libSQL database URL.
- `TURSO_AUTH_TOKEN`: control-plane database auth token.
- `WORLDS_API_URL`: data-plane API base URL.
- `WORLDS_API_ADMIN_KEY`: admin key accepted by `worlds-api`.
- `API_BASE_URL`: public base URL for this service.
- `WAZOO_ENV`: deployment environment label.
- `WAZOO_PLATFORM_ADMIN_TOKEN`: global admin token used by health checks and
  server-to-server admin calls. Must be seeded in the control-plane database.
  See [CONTRIBUTING.md](CONTRIBUTING.md) for how to generate and seed it.

Required for world database provisioning (Cloudflare Worker only):

- `TURSO_ORG`: Turso organization slug.
- `TURSO_GROUP`: Turso group name for new world databases.
- `TURSO_PLATFORM_API_TOKEN`: Turso platform API token with permission to create
  databases and issue auth tokens. This must be set as a Wrangler secret on the
  deployed Worker. Without it, creating a new World returns "Turso provisioning
  is not configured". See [CONTRIBUTING.md](CONTRIBUTING.md) for the full
  end-to-end setup (Turso CLI install, token minting, and `wrangler secret put`).

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

Apply the clean beta schema to a new libSQL database:

```sh
turso db shell <database-name> < schema.sql
```

Platform tokens use the `wzp_` prefix. Global admin tokens must be manually seeded with `kind = 'ADMIN'`, `user_uid = NULL`, and a scope containing `admin`.

Supported scopes include `users.read`, `users.write`, `worlds.read`, `worlds.write`, `worlds.admin`, `usage.read`, `billing.read`, and `admin`.

## Deployment

Cloudflare Worker:

```sh
npm run deploy:dry
npm run deploy
```

Docker component:

```sh
docker build -t ghcr.io/wazootech/wazoo-api:latest .
docker compose up
```

GitHub Actions validates formatting, typechecking, Worker dry deploy, Docker build, publishes the GHCR image on `main`, and deploys `api.wazoo.dev` on `main`.
