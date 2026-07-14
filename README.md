# Wazoo Platform API

Production-oriented TypeScript API server for Cloudflare Workers, Hono, and D1. It models platform metadata separately from data-plane world authentication.

## Resources

- Organizations: `/v1/organizations`
- Groups: `/v1/organizations/:organizationId/groups`
- Worlds: `/v1/organizations/:organizationId/worlds`
- World auth tokens: `/v1/organizations/:organizationId/worlds/:worldId/auth/tokens`
- Platform API tokens: `/v1/auth/api-tokens/:tokenName`
- Usage: `/v1/organizations/:organizationId/usage`
- Billing placeholders: `/v1/organizations/:organizationId/billing`
- Health: `/health`
- OpenAPI-ish route list: `/openapi.json`

## Setup

```sh
npm install
cp .dev.vars.example .dev.vars
wrangler d1 create wazoo-api
```

Put the generated D1 `database_id` in `wrangler.toml`, then apply the schema:

```sh
wrangler d1 execute wazoo-api --local --file schema.sql
```

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

`organizationId` route params accept either the organization id or slug, mirroring Turso's Platform API ergonomics.

World auth tokens use a separate `wzw_` prefix and live in `world_auth_tokens`; they are intended for future data-plane access, not platform administration.

## Billing

Stripe variables are present as placeholders. This repo intentionally returns billing stubs until real billing integration is added.
