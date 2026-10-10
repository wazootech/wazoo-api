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
