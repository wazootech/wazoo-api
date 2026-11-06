# Agent guidelines

This file overrides the workspace root AGENTS.md for repo-specific guidance.

## What this repo is

This repository contains the Wazoo API service.

## How to work here

- Use `package.json` scripts as the source of truth for local development,
  deployment, migrations, and checks.
- Load required environment variables before commands that contact remote
  services.
- Run typecheck, tests, or the narrowest service health check for API behavior
  changes. Health checks require `WAZOO_PLATFORM_ADMIN_TOKEN`.
- Treat schema, auth, and launch-control changes as high impact; document the
  verification path before finishing.

## Cross-repo impact

- `deploy-qa` and `health-qa` run **only** on push to `main`, so a green
  `verify` here is not evidence that the change works in a live environment.
  Say so explicitly in the PR body when you could not observe it.
- `/health` is liveness only. Schema correctness is asserted by `/ready` via
  `src/lib/world-readiness.ts`; use `/ready`, never `/health`, to judge whether
  a world-identity change is live.
- A world-contract change requires follow-ups in `wazoo-client-ts`, then
  `wazoo-console` / `wazoo-cli`. Name the required merge order in the PR.
- Never weaken the owner predicate to accommodate an identifier change. Every
  `worlds` query must carry `user_uid`; a valid `worldId` must never by itself
  grant access.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `wazootech/wazoo-api`, driven through the
`gh` CLI. PRs are not treated as a request surface. See
`docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles use their default label strings
(`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`),
alongside the `bug` / `enhancement` categories. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. Both are
optional — the `/domain-modeling` skill creates them lazily. See
`docs/agents/domain.md`.

## Code health

Family-wide rules live in the [wazootech workspace constitution](https://github.com/wazootech/workspace/blob/main/AGENTS.md#code-health-standards); this repo's specifics:

- Before pushing, run what CI runs: `pnpm run format:check`, `pnpm run lint` (`--max-warnings 0`), `pnpm run typecheck`, and `pnpm exec vitest run --coverage`.
- Coverage floors live in `vitest.config.ts` and only rise: lines 76, functions 79, branches 61, statements 75. Never lower one to land a change.
- The `openapi-breaking` job (oasdiff, `fail-on: ERR`) blocks breaking changes to `openapi/openapi.json`. Never hand-edit the snapshot or a generated client; regenerate. Downstream chain: `worlds-api` / `wazoo-api` -> `worlds-client-ts` / `wazoo-client-ts` -> `wazoo-console` / `wazoo-cli`. List dependents and merge order in the PR.
- `@typescript-eslint/no-explicit-any` is `error` in `src/`, `scripts/`, and `tests/`. Fix with real types or `unknown`; the one justified `any` is `respond()`, under an `eslint-disable` with its reason.
- `.gitleaksignore` holds exact fingerprints for verified fixture strings only. Never add regex allowlists or disable a rule. `secret-scan.yml` runs gitleaks on every PR and push to `main`.
- Third-party actions are pinned to full SHAs; CI Node comes from `.node-version` (deploy jobs keep an explicit `node-version`). `code-health.yml` (file length, TODO/FIXME without an issue) is warn-only. `.github/CODEOWNERS` assigns review.
