# Secret Registry

## Canonical source: Infisical

The canonical source for every runtime secret is the
[Infisical](https://infisical.com) project described in the workspace-level
migration runbook (`infisical-secrets-migration.md` at the root of the
wazootech workspace repo). That runbook owns the full inventory, the
dev/qa/prod separation, and the cutover sequence; this file records only how
wazoo-api consumes it.

- Local secret files (`.env`, `.dev.vars`) are **retired**. There is no
  committed copy in this repo's history and nothing needs rotating on account
  of the migration. Secrets reach local processes by injection:
  `infisical run --env=dev -- npm run dev` (or `npm run secrets:check` to
  confirm what resolved, printing names and lengths only).
- `.infisical.json` at the repo root is the committed project link
  (`workspaceId`, `defaultEnvironment: dev`). It holds no secret values and is
  safe to commit. It replaces the interactive `infisical init` step.
- Deployed Worker secrets are owned by an **Infisical Cloudflare Workers Secret
  Sync**, configured in the Infisical dashboard (Project Integrations → Secret
  Syncs). `wrangler deploy` is plain and sets no secrets; provisioning happens
  continuously, independently of deploys.
- Secret **values** are never documented here or in any other file — only
  names, environments, owners, and rotation dates.

## wazoo-api

| Secret | Infisical env | Prod Worker | QA Worker | Local `dev` | Notes |
| --- |---|---|---|---|---|
| `WORLDS_API_ADMIN_KEY` | dev, qa, prod | via sync | via sync | injected | Platform→data-plane admin key (`wzw_` prefix). Sent **as a bearer token** by `src/lib/worlds-client.ts:16` when wazoo-api calls worlds-api. worlds-api's `authorize()` accepts it, bypassing `api_keys`. |
| `WAZOO_PLATFORM_ADMIN_TOKEN` | dev, qa, prod | via sync | via sync | injected | Platform→platform admin credential (`wzp_` prefix). Authenticated **into** wazoo-api via `src/routes/auth.ts:76` — the `Authorization: Bearer` token checked for admin route access. |
| `WORKOS_API_KEY` | dev, qa, prod | via sync | via sync | injected | WorkOS SSO API key (`sk_` prefix). Used in `src/routes/auth.ts:146,199` to exchange auth codes and refresh sessions. |
| `WORKOS_CLIENT_ID` | dev, qa, prod | via sync | via sync | injected | WorkOS OIDC client identifier. Used alongside `WORKOS_API_KEY` in `src/routes/auth.ts:200`. |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | qa, prod | via sync | via sync | n/a | GCP service-account key (JSON). Used in `src/lib/beta-allowlist.ts:49` to verify allowlisted beta testers and `src/routes/auth.ts:117`. Not present in dev. |
| `RESEND_API_KEY` | qa, prod | ⚠️ see provenance gap | via sync | n/a | Resend API key (`re_` prefix). Used in `src/lib/email.ts:14` for transactional email. **Prod binding has no vault source** (see §5). |
| `OTP_FROM_ADDRESS` | **not in vault** | ⚠️ orphan Worker secret | ⚠️ orphan Worker secret | n/a | "From" address for OTP emails. Read in `src/lib/email.ts:15`; falls back to `Wazoo <noreply@mail.wazoo.dev>` if unbound. Not in any Infisical environment or path. |
| `WORKOS_COOKIE_PASSWORD` | dev, qa, prod | via sync | via sync | injected | ⚠️ **BOUND BUT NOT READ BY THIS SERVICE.** See §5 drift notes. Likely a copy-paste from console sync; should be removed. |

### Non-secret configuration

`WAZOO_ENV`, `PORT`, `CORS_ORIGINS`, and routing knobs are configuration, not
secrets. They live in `wrangler.toml` `[vars]` / `[env.qa.vars]` or in the local
shell, and are deliberately **not** in the vault.

## Runtime delivery

| Target | Path |
| --- | --- |
| Local dev | `npm run dev` → `scripts/dev.mjs` → `wrangler dev` under `infisical run --env=dev`; `CLOUDFLARE_INCLUDE_PROCESS_ENV=true` makes Wrangler pass the injected values into the Worker. |
| QA Worker | Infisical Secret Sync (project `wazoo-n-jx-j`, source `/`, env `qa`) → script `wazoo-api-qa`. Deletion protection **on**. |
| Prod Worker | Infisical Secret Sync (project `wazoo-n-jx-j`, source `/`, env `prod`) → script `wazoo-api`. Deletion protection **on**. |
| CI (`health-qa`) | `Infisical/secrets-action@v1.0.17` with `method: oidc`, env `qa`, `secret-name: WAZOO_PLATFORM_ADMIN_TOKEN`. Per-repo machine identity subject `repo:wazootech@197434733/wazoo-api@<id>:ref:refs/heads/main`. Needs `permissions: id-token: write` and the `INFISICAL_MACHINE_ID` / `INFISICAL_PROJECT_SLUG` repository **variables**. |
| CI (deploy jobs) | No secrets injected. `wrangler deploy` sets none, and the Worker copy belongs to the sync. |

## Operational notes

- **You hold both admin keys.** Unlike worlds-api (which holds only the data-plane
  key) and the console (which holds only the platform token), wazoo-api holds
  both: `WAZOO_PLATFORM_ADMIN_TOKEN` authenticates **into** wazoo-api, and
  `WORLDS_API_ADMIN_KEY` authenticates wazoo-api **as a client of** worlds-api.
  Deleting either copy breaks a real call path.

- **Verify, don't assume.** `npx wrangler secret list` should show all 8 names on
  both envs. An authenticated probe through
  `infisical run --env=qa -- npm run health:local -- https://api-qa.wazoo.dev`
  confirms the values the Worker actually holds match the vault.

- **Rotation** is a vault edit: change the value in Infisical and let the sync
  push it. The QA and prod values must differ by design.

- **Deletion protection is on for both syncs.** Neither the QA nor the prod
  wazoo-api sync will remove a secret from the Worker when it disappears from
  the root path.

## §5 — Provenance gaps and drift

### Provenance gaps (high priority)

1. **`OTP_FROM_ADDRESS` has no vault source.** It is bound on both the prod
   and QA wazoo-api Workers, but it appears in **no** Infisical environment
   or path (not in dev, qa, or prod root; not in any subfolder). It was almost
   certainly set as a direct Worker secret (`wrangler secret put`) outside the
   vault sync. The code falls back to
   `Wazoo <noreply@mail.wazoo.dev>` when unbound, so the binding can be removed
   safely in the short term, but a real sender address is needed for
   deliverability. **Resolution:** create `OTP_FROM_ADDRESS` in the shared
   Infisical project (prod and qa root) and let the sync republish it. The
   manual Worker secret should then be removed.

2. **`RESEND_API_KEY` prod binding has no vault source.** The qa binding
   sources from qa root (correct), but the prod Worker binds
   `RESEND_API_KEY` while the prod vault holds only 6 secrets (no
   `RESEND_API_KEY`). Either the value was promoted to prod as a direct Worker
   secret, or the prod sync is misconfigured. Either way, the prod value is
   invisible to version control and outside the documented provisioning path.
   **Resolution:** add `RESEND_API_KEY` to prod root in Infisical (or confirm
   the prod sync is sourcing from the correct env) and remove any direct
   Worker secret.

3. **`RESEND_API_KEY` on `wazoo-console` qa** is bound and present in the qa
   vault root, but **no code path in wazoo-console reads it.** Console routes
   email/billing through `wazoo-api`. This qa-only binding appears to be an
   accidental carry-over. Safe to remove after confirming no console email path
   exists.

### Drift — bound but not read by this service

| Secret | Bound on | In vault? | Read by wazoo-api? | Verdict |
| --- | --- | --- | --- | --- |
| `WORKOS_COOKIE_PASSWORD` | prod, qa, dev | ✅ | ❌ no | ⚠️ Copy-paste from console — wazoo-api's WorkOS usage (auth code exchange) does not set/consume session cookies. Should be removed from the wazoo-api Worker sync. |

> **NOTE on `WORKOS_COOKIE_PASSWORD`:** An earlier revision of the workspace
> inventory (`docs/secret-inventory.md`) concluded this secret was a phantom —
> "declared nowhere, read zero times." That was a **false zero**. See §5 of that
> file for the full resolution: the console's AuthKit SDK reads it from
> `process.env` at module scope, and a live QA probe (307 → workos.com with
> sealed PKCE state) confirmed it is required. For **this** service, however,
> wazoo-api does not render sessions or seal cookies — its WorkOS usage is
> server-side token exchange only. The secret is therefore genuinely unused here.

## Single source of truth for `WORLDS_API_ADMIN_KEY`

The value lives in **one** place: the shared `wazoo-n-jx-j` project, environment
`qa` and `prod`, at the project root. worlds-api syncs from `/worlds-api`
(which holds an Infisical **reference** `${qa.WORLDS_API_ADMIN_KEY}` /
`${prod.WORLDS_API_ADMIN_KEY}`, not a second copy). wazoo-api syncs from `/`
(root). The QA and prod values differ by design, and wazoo-api must send the QA
value when calling the QA Worker and the prod value when calling the prod Worker.

## Outstanding work

| Action | Status |
| --- | --- |
| Vault `OTP_FROM_ADDRESS` in prod and qa root | **Open** — see §5 provenance gap #1 |
| Vault `RESEND_API_KEY` in prod root | **Open** — see §5 provenance gap #2 |
| Remove `WORKOS_COOKIE_PASSWORD` from wazoo-api Worker binds | **Open** — see §5 drift |
| Remove `RESEND_API_KEY` from wazoo-console qa only if confirmed unused | **Open** — see §5 provenance gap #3 |
| Remove `WORLDS_API_ADMIN_KEY` from wazoo-console Worker binds (console proxies through wazoo-api) | **Open** — see `docs/secret-inventory.md` §4 drift |

Last audited: 2026-10-05
