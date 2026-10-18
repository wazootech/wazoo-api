# Secret Registry

## Canonical source: Infisical

The canonical source for every runtime secret is the
[Infisical](https://infisical.com) project `wazoo-n-jx-j`. That project's
topology — its environments, folder layout, live inventory, the Cloudflare
Worker syncs, and the rule for where a new secret goes — is recorded in the
private ops home, `wazootech/memory` (`wiki/Infisical_(vault).md`); this file
records only how wazoo-api consumes it.

- There is no `dev` environment in the vault. Local development brings its own
  resources: a gitignored `.dev.vars` copied from `.dev.vars.example`, holding
  values you choose yourself (see `CONTRIBUTING.md`). Vault values (`qa`,
  `prod`) are never copied into local files. Org members inject the `qa` value
  only for QA checks, with `infisical run --env=qa -- <command>`.
- This repo has **no** `.infisical.json`, so `infisical` cannot resolve the
  project from `repos/wazoo-api` on its own. For QA commands, run from a
  checkout that carries the link (`repos/worlds-api` does), or pass the project
  id explicitly. (An earlier revision of this file claimed a committed
  `.infisical.json` at this repo root; no such file exists.)
- Deployed Worker secrets are owned by an **Infisical Cloudflare Workers Secret
  Sync**, configured in the Infisical dashboard (Project Integrations → Secret
  Syncs). `wrangler deploy` is plain and sets no secrets; provisioning happens
  continuously, independently of deploys.
- Secret **values** are never documented here or in any other file — only
  names, environments, owners, and rotation dates.

## wazoo-api

| Secret | Infisical env | Prod Worker | QA Worker | Local dev | Notes |
| --- |---|---|---|---|---|
| `WORLDS_API_ADMIN_KEY` | qa, prod | via sync | via sync | own value | Platform→data-plane admin key (`wzw_` prefix). Sent **as a bearer token** by `src/lib/worlds-client.ts:16` when wazoo-api calls worlds-api. worlds-api's `authorize()` accepts it, bypassing `api_keys`. |
| `WAZOO_PLATFORM_ADMIN_TOKEN` | qa, prod | via sync | via sync | own value | Platform→platform admin credential (`wzp_` prefix). Authenticated **into** wazoo-api via `src/routes/auth.ts:76` — the `Authorization: Bearer` token checked for admin route access. |
| `WORKOS_API_KEY` | qa, prod | via sync | via sync | own value | WorkOS SSO API key (`sk_` prefix). Used in `src/routes/auth.ts:146,199` to exchange auth codes and refresh sessions. |
| `WORKOS_CLIENT_ID` | qa, prod | via sync | via sync | own value | WorkOS OIDC client identifier. Used alongside `WORKOS_API_KEY` in `src/routes/auth.ts:200`. |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | qa, prod | via sync | via sync | n/a | GCP service-account key (JSON). Used in `src/lib/beta-allowlist.ts:49` to verify allowlisted beta testers and `src/routes/auth.ts:117`. |
| `RESEND_API_KEY` | qa (`/wazoo-api`) | ⚠️ see provenance gap | via sync | n/a | Resend API key (`re_` prefix). Used in `src/lib/email.ts:14` for transactional email. **The prod binding has no vault source** (see §5). |
| `OTP_FROM_ADDRESS` | **not in vault** | ⚠️ orphan Worker secret | ⚠️ orphan Worker secret | n/a | "From" address for OTP emails. Read in `src/lib/email.ts:15`; falls back to `Wazoo <noreply@mail.wazoo.dev>` if unbound. Not in any Infisical environment or path. |
| `WAZOO_EMBEDDINGS_PROVIDER_KEY` | qa (`/ci`) | no | no | n/a | Platform's own provider key for the BYOK embeddings acceptance round-trip (`scripts/qa-roundtrip.mjs`). Deliberately in the vault folder `/ci`, not at the project root, so no Worker Secret Sync publishes it. Inject it with `infisical run --env=qa --path=/ --path=/ci -- pnpm run roundtrip:qa` — a `--path` replaces the default root, so both paths must be named to get the root secrets too. `/ci` also holds `CLOUDFLARE_API_TOKEN`, so that run injects it as well; the script does not read it. |

### Non-secret configuration

`WAZOO_ENV`, `PORT`, `CORS_ORIGINS`, and routing knobs are configuration, not
secrets. They live in `wrangler.toml` `[vars]` / `[env.qa.vars]` or in the local
shell, and are deliberately **not** in the vault.

## Runtime delivery

| Target | Path |
| --- | --- |
| Local dev | `pnpm run dev` → `wrangler dev`, reading your own gitignored `.dev.vars`. No vault involvement. |
| QA Worker | Infisical Secret Sync (project `wazoo-n-jx-j`, source `/wazoo-api`, env `qa`) → script `wazoo-api-qa`. Deletion protection **on**. |
| Prod Worker | Infisical Secret Sync (project `wazoo-n-jx-j`, source `/wazoo-api`, env `prod`) → script `wazoo-api`. Deletion protection **on**. |
| CI (`health-qa`) | `Infisical/secrets-action@v1.0.17` with `method: oidc`, env `qa`, `secret-name: WAZOO_PLATFORM_ADMIN_TOKEN`. Per-repo machine identity subject `repo:wazootech@197434733/wazoo-api@<id>:ref:refs/heads/main`. Needs `permissions: id-token: write` and the `INFISICAL_MACHINE_ID` / `INFISICAL_PROJECT_SLUG` repository **variables**. |
| CI (deploy jobs) | `Infisical/secrets-action@v1.0.17` with `method: oidc`, env `qa` / `prod`, `secret-path: /ci`, `secret-name: CLOUDFLARE_API_TOKEN`. The deploy credential lives at vault folder `/ci` and is deliberately **not** at the root, so no Worker Secret Sync binds it onto a runtime Worker. `wrangler deploy` sets no Worker secrets; the Worker copies belong to the sync. |

## Operational notes

- **You hold both admin keys.** Unlike worlds-api (which holds only the data-plane
  key) and the console (which holds only the platform token), wazoo-api holds
  both: `WAZOO_PLATFORM_ADMIN_TOKEN` authenticates **into** wazoo-api, and
  `WORLDS_API_ADMIN_KEY` authenticates wazoo-api **as a client of** worlds-api.
  Deleting either copy breaks a real call path.

- **Verify, don't assume.** `npx wrangler secret list` should show the 7 names in the table above on
  both envs. An authenticated probe through
  `infisical run --env=qa -- npm run health:local -- https://api-qa.wazoo.dev`
  confirms the values the Worker actually holds match the vault.

- **Rotation** is a vault edit: change the value in Infisical and let the sync
  push it. The QA and prod values must differ by design.

- **Deletion protection is on for both syncs.** Neither the QA nor the prod
  wazoo-api sync will remove a secret from the Worker when it disappears from
  `/wazoo-api`.

## §5 — Provenance gaps

Measured 2026-10-18. The Worker bindings were cleaned up in the folder
migration (tracker [wazootech/memory#57](https://github.com/wazootech/memory/issues/57)):
`CLOUDFLARE_API_TOKEN` and `WORKOS_COOKIE_PASSWORD`, which this service never
reads, were deleted from both Workers, and the console Workers lost their own
unused bindings. Two gaps remain.

1. **`OTP_FROM_ADDRESS` has no vault source.** It is bound on both the prod
   and QA wazoo-api Workers, but it appears in **no** Infisical environment
   or path. It was set as a direct Worker secret (`wrangler secret put`)
   outside the vault sync. The code falls back to
   `Wazoo <noreply@mail.wazoo.dev>` when unbound. **Resolution:** add
   `OTP_FROM_ADDRESS` to `/wazoo-api` in `qa` and `prod` and let the sync
   republish it, or move it to `wrangler.toml` `[vars]` since it is not a secret.

2. **`RESEND_API_KEY` prod binding has no vault source.** `/wazoo-api` in `qa`
   holds the key; `/wazoo-api` in `prod` does not, yet the prod Worker binds
   it. The prod value is invisible to the vault. **Resolution:** add a reissued
   prod key to `/wazoo-api` in `prod`. Deletion protection keeps the existing
   binding until then.

## Single source of truth for `WORLDS_API_ADMIN_KEY`

The canonical value lives at the root of the shared `wazoo-n-jx-j` project,
environment `qa` and `prod`. The service folders (`/wazoo-api`, `/worlds-api`)
each hold a **literal copy**, not an Infisical reference (checked 2026-10-18),
so rotating the key means editing root and both folders in the same
environment, then letting the syncs publish. The QA and prod values differ by
design, and wazoo-api must send the QA value when calling the QA Worker and the
prod value when calling the prod Worker.

## Outstanding work

| Action | Status |
| --- | --- |
| Vault `OTP_FROM_ADDRESS` (or move it to `[vars]`) | **Open** — see §5 gap #1 |
| Vault a reissued `RESEND_API_KEY` in `/wazoo-api` `prod` | **Open** — see §5 gap #2 |
| Point each sync at its service folder; delete unused Worker bindings | **Done** 2026-10-18 |

Last audited: 2026-10-18
