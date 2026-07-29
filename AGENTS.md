# Agent guidelines

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
