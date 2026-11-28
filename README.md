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
- `WAZOO_ENV`: deployment environment label (`prod`, `preview`, `qa`, `dev`, `test`).
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

### World-identity round trip

`pnpm run roundtrip:qa` (`scripts/qa-roundtrip.mjs`) exercises the world
lifecycle end to end against `api-qa` / `data-qa` and writes evidence JSON to an
optional path argument. It requires `WAZOO_PLATFORM_ADMIN_TOKEN`.

Set `WAZOO_EMBEDDINGS_ACCEPTANCE=1` to additionally run the bring-your-own-key
embeddings acceptance (worlds-api#1): it also needs `WORLDS_API_ADMIN_KEY` and
`WAZOO_EMBEDDINGS_PROVIDER_KEY` (a personal ephemeral provider key exported for
the run, or the capped QA-only key from the vault folder `/ci`). Set
`WAZOO_EMBEDDINGS_PROVIDER` to `openai` (default) or `openrouter` to match the key. It sets and then
revokes a namespace embedding credential and asserts hybrid search, paraphrase
retrieval, and cross-world vector isolation. It is skipped by default because
it needs a provider key and the target worlds-api needs `EMBEDDING_KEK_V1`;
without them hosted search is keyword-only.

## Development

```sh
pnpm install
cp .dev.vars.example .dev.vars
pnpm run dev
pnpm run typecheck
```

The control plane uses Cloudflare D1. Apply `schema.sql` through the approved D1 deployment/provisioning process before serving traffic.

Platform tokens use the `wzp_` prefix. Global admin tokens must be manually seeded with `kind = 'ADMIN'`, `user_uid = NULL`, and a scope containing `admin`.

Supported scopes include `users.read`, `users.write`, `worlds.read`, `worlds.write`, `usage.read`, `billing.read`, and `admin`.

## Deployment

Cloudflare Worker:

```sh
pnpm run deploy:dry
pnpm run deploy
```

### Production

Cloudflare Workers Builds is connected to this repository on the `wazoo-api`
Worker. On each push to `main` it runs the checks in its build command and then
`pnpm run deploy`, stamping the commit into `BUILD_GIT_SHA`; a failing check
stops the deploy. The commands and the build token are Worker settings in the
Cloudflare dashboard (Settings, Builds), and builds for other branches are off.
To redeploy the current `main`, retry its latest build on the Worker's
Deployments page. When the `Workers Builds: wazoo-api` check passes,
`post-deploy.yml` runs the production canary.

### PR previews

The `wazoo-api-preview` Worker exists and its secrets come from the vault folder of the
same name, but nothing builds pull requests: preview builds would run unmerged
code with a build token that can reach other Workers. Upload a preview by hand
from the branch, signed in to the Wazoo Cloudflare account with `wrangler login`:

```sh
pnpm exec wrangler versions upload -c wrangler.preview.toml --preview-alias <alias> \
  --define "BUILD_GIT_SHA:\"$(git rev-parse HEAD)\""
```

Wrangler prints the preview's `workers.dev` address. The `*.preview.*.wazoo.dev`
hostnames do not serve previews yet. The intended automated design follows: previews come from Cloudflare Workers Builds, using
`wrangler.preview.toml`. The credential stays in Cloudflare and is scoped to a
separate `wazoo-api-preview` Worker, so it can't deploy QA or prod. Every
branch pushed to this repo gets a `<alias>.preview.api.wazoo.dev` URL
(`WAZOO_ENV=preview`), and Cloudflare comments it on the PR. Previews share the
QA D1 database (`wazoo-api-qa`) and its data. Schema changes are never applied
by a preview deploy: apply the migration to that database by hand before
exercising a PR that needs it, and note that every other open preview sees it.
Console previews (`*.preview.console.wazoo.dev`) are allowed by CORS on the
`preview` and `qa` environments only, never prod. Branch code runs with the
preview Worker's secrets, so treat write access to this repo as access to them.

Workers Builds settings for the `wazoo-api-preview` Worker (Settings, Builds):

| Setting | Value |
| --- | --- |
| Git repository | `wazootech/wazoo-api` |
| Root directory | `/` |
| Build command | empty (wrangler bundles `src/index.ts`) |
| Deploy command (production branch) | `npx wrangler deploy -c wrangler.preview.toml` |
| Non-production branch deploy command | `npx wrangler versions upload -c wrangler.preview.toml` |
| Build variables | none |
| Runtime secrets (Variables and Secrets) | the QA values of `WORLDS_API_ADMIN_KEY`, `WAZOO_PLATFORM_ADMIN_TOKEN`, `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, plus `RESEND_API_KEY` and `GOOGLE_SERVICE_ACCOUNT_KEY` if sign-in is exercised |
| Previews (Settings, Domains and Routes) | `preview.api.wazoo.dev` custom domain with Previews enabled, so `<alias>.preview.api.wazoo.dev` resolves |

Check the config with `pnpm run preview:dry`.

GitHub Actions checks pull requests and `main`. It holds no Cloudflare or Infisical credential and deploys nothing.

Docker Compose is not a supported runtime for this service because D1 is a
Cloudflare-managed binding. Use Wrangler for local development and D1 schema
initialization.
