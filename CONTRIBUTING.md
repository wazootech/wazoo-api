# Contributing to wazoo-api

## Local development setup

1. Install dependencies with [pnpm](https://pnpm.io) (version pinned by
   `packageManager`; install it with `npm install -g pnpm`, since Corepack
   cannot run pnpm 12 yet):

   ```sh
   pnpm install
   ```

2. Copy the local dev vars template:

   ```sh
   cp .dev.vars.example .dev.vars
   ```

3. Fill in `.dev.vars` with real values.

4. Create the local D1 control-plane database and seed a global admin token.
   Both commands write only to Wrangler's local state in `.wrangler/`:

   ```sh
   pnpm exec wrangler d1 execute wazoo-api --local --file schema.sql
   CLOUDFLARE_D1_DATABASE=wazoo-api    WAZOO_PLATFORM_ADMIN_TOKEN_NAME="local-admin"    pnpm run launch:seed-admin-d1 --local
   ```

5. Save the printed `wzp_...` token into `.dev.vars` as `WAZOO_PLATFORM_ADMIN_TOKEN`.

6. Start the local dev server:

   ```sh
   pnpm run dev
   ```

7. Run checks:
   ```sh
   pnpm run typecheck
   pnpm run test
   pnpm run format:check
   ```

## Health checks

- Local: `pnpm run health:local`
- QA: `pnpm run health:beta`

Both require `WAZOO_PLATFORM_ADMIN_TOKEN` to be set.

## Environment files

- `.dev.vars` — local development secrets (gitignored).
- `.env.qa` — QA reference values (gitignored).
- `.env.production` — production reference values (gitignored).
- `.dev.vars.example`, `.env.qa.example`, `.env.production.example` — committed templates.

## Pull request workflow

1. Create a feature worktree from a clean `main` baseline.
2. Make focused, atomic commits.
3. Run `pnpm run format:check`, `pnpm run typecheck`, and `pnpm test` before pushing.
4. Open a PR and wait for CI to pass.
