# Contributing to Wazoo Platform API

This guide covers how to set up the repo for development and how operators can
provision the secrets required for remote environments (QA and production).

## Development setup

```sh
npm install
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your local values
npm run dev
```

Run checks before committing:

```sh
npm run format:check
npm run typecheck
npm test
```

## Secrets

Some configuration values are intentionally **not** in `wrangler.toml` and must
be managed as Wrangler secrets.

### `TURSO_PLATFORM_API_TOKEN`

This token is required for the `/v1/worlds` create flow. Without it, the
endpoint returns:

```text
Turso provisioning is not configured
```

The token must have permission to create databases and issue full-access auth
tokens under the Turso organization configured in `wrangler.toml`.

#### Creating and uploading the token

On Windows, the Turso CLI does not ship a native binary. Install it inside WSL:

```bash
curl -sSfL https://get.tur.so/install.sh | bash
```

Authenticate:

```bash
export PATH="$HOME/.turso:$PATH"
turso auth login
```

This opens a browser to complete OAuth. After login succeeds, mint an
organization-scoped token for the target environment:

```bash
export PATH="$HOME/.turso:$PATH"
turso auth api-tokens mint wazoo-api-qa --org ethanthatonekid
```

The example uses `ethanthatonekid`; replace it with the actual Turso
organization slug. New world databases are created in the Turso group
configured in `wrangler.toml` (`wazoo` by default).

Upload the emitted token to the QA Worker:

```powershell
# PowerShell: pipe the minted token directly into Wrangler
wsl -e bash -c '
  export PATH="$HOME/.turso:$PATH"
  turso auth api-tokens mint wazoo-api-qa --org ethanthatonekid
' | npx wrangler secret put --env qa TURSO_PLATFORM_API_TOKEN
```

For production, replace `--env qa` with the default environment and use a
distinct token name such as `wazoo-api-prod`.

#### Verifying the secret

```sh
npx wrangler secret list --env qa
```

`TURSO_PLATFORM_API_TOKEN` should appear in the output.

### Other secrets

The following secrets are also required for QA/production and are documented in
`wrangler.toml` and the README:

- `TURSO_AUTH_TOKEN`
- `WORLDS_API_ADMIN_KEY`: must match the `WORLDS_ADMIN_KEY` secret in the
  `worlds-api` QA/production Worker. This key is used when provisioning a new
  world in the data plane. If it is missing or mismatched, world creation fails
  with `WORLD_PROVISIONING_FAILED` / "Missing or invalid API key".
- `WORKOS_API_KEY`
- `WORKOS_CLIENT_ID`
- `WAZOO_PLATFORM_ADMIN_TOKEN`
- `STRIPE_SECRET_KEY` (billing flows)
- `STRIPE_WEBHOOK_SECRET` (billing flows)
- `GOOGLE_SERVICE_ACCOUNT_KEY` (private beta allowlist sync)

## Deployment

Pushes to `main` trigger CI (see `.github/workflows/ci.yml`). Operators can also
deploy manually:

```sh
# QA
npm run deploy -- --env qa

# Production
npm run deploy
```

## Control-plane schema

Apply `schema.sql` to the control-plane libSQL database for the target
environment:

```sh
turso db shell <control-database-name> < schema.sql
```

## Data-plane schema

The `worlds-api` service owns its own libSQL database (`worlds-api-qa` /
`worlds-api-prod`). Its `schema.sql` must be applied before any worlds can be
provisioned. If it is missing, `wazoo-api` returns
`WORLD_PROVISIONING_FAILED` / "no such table: worlds_metadata".

Apply it from the `worlds-api` repository:

```sh
cd ../worlds-api
turso db shell worlds-api-qa < schema.sql
```
