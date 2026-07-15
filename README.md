# Wazoo Platform API

Production-oriented TypeScript API server for Cloudflare Workers, Hono, and Turso/libSQL. It models platform metadata separately from data-plane world authentication.

## Resources

- Organizations: `/v1/organizations`
- Worlds: `/v1/organizations/:organizationId/worlds`
- World auth tokens: `/v1/organizations/:organizationId/worlds/:worldId/auth/tokens`
- Platform API tokens: `/v1/auth/api-tokens/:tokenName`
- Usage: `/v1/organizations/:organizationId/usage`
- Limits: `/v1/organizations/:organizationId/limits`
- Billing stubs: `/v1/organizations/:organizationId/billing`, `/v1/organizations/:organizationId/billing:openPortal`, `/v1/stripe/webhook`
- Health: `/health`
- OpenAPI-ish route list: `/openapi.json`

## Setup

```sh
npm install
cp .dev.vars.example .dev.vars
```

Create a Turso/libSQL control database, put `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in `.dev.vars`, then apply the schema with the Turso CLI:

```sh
turso db shell <database-name> < schema.sql
```

For production, set `TURSO_AUTH_TOKEN` and `TURSO_PLATFORM_API_TOKEN` with `wrangler secret put`, then configure `TURSO_DATABASE_URL`, `TURSO_ORGANIZATION_SLUG`, `TURSO_GROUP`, and `WAZOO_ENV` in `wrangler.toml` or your deployment environment.

`TURSO_PLATFORM_API_TOKEN` is used to create one Turso database per World and mint short-lived database auth tokens for schema initialization. The generated database tokens are not stored.

## Development

```sh
npm run dev
npm run typecheck
```

Most routes require a platform token:

```http
Authorization: Bearer wzp_...
```

To bootstrap the first platform token, generate a random token, hash it with SHA-256, and insert the hash into `platform_api_tokens`. Token creation endpoints only return plaintext once.

Supported platform scopes include `organizations.read`, `organizations.write`, `worlds.read`, `worlds.write`, `worlds.admin`, `usage.read`, `billing.read`, and `admin`.

Public resource IDs must match `^[a-z][a-z0-9-]{2,62}$`. Internal UIDs use prefixes like `org_` and `w_` and are output-only.

Create organizations with `organizationId` and `organization.displayName`; create worlds with `worldId` and `world.displayName`. Responses use AIP-style `name`, `uid`, and `displayName` fields.

The control schema mirrors that language with `organization_id`, `world_id`, and `display_name` columns. Organization and World deletes are soft-retained with `delete_time` and `expire_time`; purge is an internal follow-up path.

World auth tokens use a separate `wzw_` prefix and live in `world_auth_tokens`; they are intended for future data-plane access, not platform administration.

## Billing

Stripe variables are present for sandbox wiring. Billing responses are Stripe-shaped stubs and do not require live payment for beta-free organizations. Usage and limits use transparent resource accounting; usage ingestion returns `RESOURCE_EXHAUSTED` when a configured metric limit would be exceeded.
