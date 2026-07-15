# Wazoo Platform API

Production-oriented TypeScript API server for Cloudflare Workers, Hono, and D1. It models platform metadata separately from data-plane world authentication.

## Resources

- Organizations: `/v1/organizations`
- Worlds: `/v1/organizations/:organizationId/worlds`
- World auth tokens: `/v1/organizations/:organizationId/worlds/:worldId/auth/tokens`
- Platform API tokens: `/v1/auth/api-tokens/:tokenName`
- Usage: `/v1/organizations/:organizationId/usage`
- Billing stubs: `/v1/organizations/:organizationId/billing`, `/v1/organizations/:organizationId/billing:openPortal`, `/v1/stripe/webhook`
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

Supported platform scopes include `organizations.read`, `organizations.write`, `worlds.read`, `worlds.write`, `worlds.admin`, `usage.read`, `billing.read`, and `admin`.

Public resource IDs must match `^[a-z][a-z0-9-]{2,62}$`. Internal UIDs use prefixes like `org_` and `w_` and are output-only.

Create organizations with `organizationId` and `organization.displayName`; create worlds with `worldId` and `world.displayName`. Responses use AIP-style `name`, `uid`, and `displayName` fields.

World auth tokens use a separate `wzw_` prefix and live in `world_auth_tokens`; they are intended for future data-plane access, not platform administration.

## Billing

Stripe variables are present for sandbox wiring. Billing responses are Stripe-shaped stubs and do not require live payment for beta-free organizations.
