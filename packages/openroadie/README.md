# OpenRoadie

Standalone distribution of the OpenRoadie developer portal — the UI and API run
in a single process. Bring your own PostgreSQL database.

## Install

<!--
================================ TODO (LAUNCH) ================================
Open-sourcing is PAUSED. Until launch this package is published PRIVATELY under
the scoped name `@roadiehq/openroadie` (npm only allows *scoped* packages to be
private). At open-source launch, flip it back to the public unscoped name:

  1. set the CI repo variable OPENROADIE_PACKAGE_NAME=openroadie
  2. set OPENROADIE_NPM_ACCESS=public
  3. restore the install command below to `npm install -g openroadie`
  4. deprecate/redirect the private @roadiehq/openroadie package

Until then the command below is `@roadiehq/openroadie` and requires npm auth to
the roadiehq org (it is not public).
==============================================================================
-->

```bash
npm install -g @roadiehq/openroadie   # TODO(launch): becomes `openroadie` (public) — see comment above
```

> Install **either** this package **or** `@roadiehq/openroadie-cli` globally — both provide the
> `openroadie` command (this one _is_ the server; the CLI orchestrates the Docker deployment), and
> a second global install silently wins the bin link.

## Quick start

```bash
mkdir my-portal && cd my-portal
openroadie init        # creates app-config.yaml + .env (with a generated auth secret)
# edit .env so DATABASE_URL points at your Postgres
openroadie             # serves http://localhost:7008
```

Open http://localhost:7008 — the portal UI and its `/api` are served from the
same origin. Database migrations run automatically on startup.

## Requirements

- Node.js >= 22
- A reachable PostgreSQL database (set `DATABASE_URL` in `.env`)

  ```bash
  docker run -d --name openroadie-db -p 5432:5432 \
    -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=openroadie postgres:16
  ```

## Configuration

- `app-config.yaml` in the working directory (override path with `--config`).
- `${VAR}` references and a local `.env` are substituted in.
- Any key can be overridden with `APP_CONFIG_*` env vars, e.g.
  `APP_CONFIG_backend_listen_port=8080`.

By default the server binds to `127.0.0.1` and runs with authentication
disabled — suitable for local, single-user use. Before exposing OpenRoadie on a
network, set `backend.listen.host: 0.0.0.0` and configure authentication.

## Commands

| Command             | Description                           |
| ------------------- | ------------------------------------- |
| `openroadie`        | Serve the portal (UI + API)           |
| `openroadie init`   | Scaffold `app-config.yaml` and `.env` |
| `openroadie --help` | Show usage                            |
