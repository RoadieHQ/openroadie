# Running openroadie in Docker

The container files at the repository root — `Dockerfile`,
`docker-compose.yml` and `app-config.docker.yaml` — exist so that
`docker compose up` gives you a working openroadie on a laptop in one command.

**They are an example, not a production deployment.** They are tuned for getting
started quickly and for local evaluation. Treat them as a starting point you
copy and harden, not as a configuration to run as-is on a machine other people
can reach.

## What the files are

| File                     | Role                                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile`             | Builds the server image. Its `CMD` loads `app-config.yaml` and then `app-config.docker.yaml`, in that order.               |
| `app-config.docker.yaml` | The container overlay. It only redirects the Postgres connection at env vars; everything else is inherited from the base.  |
| `docker-compose.yml`     | The server plus a Postgres, wired together with a healthcheck. Also shipped inside the `@roadiehq/openroadie-cli` package. |

Because the overlay only touches the database connection, **everything else in
`app-config.yaml` applies inside the container**, including the parts that are
deliberately permissive for local use.

## What is not production-ready

None of the following are bugs. They are what makes the quickstart a
one-command experience, and each one is a deliberate trade you need to reverse
before exposing an instance.

- **No authorization.** The default scope service grants every scope, so the
  REST API and the MCP server do not gate requests. Wire a real token-to-scopes
  retriever into `scopeServiceRef` (see `packages/backend/src/index.ts`) before
  anyone else can reach the instance.
- **A published signing key.** `app-config.yaml` carries the literal
  `development-secret-do-not-use-in-production` under `backend.auth.keys`, and
  the container inherits it. Anyone can read it — it is in a public repository
  and baked into a public image.
- **A published database password.** `docker-compose.yml` sets the Postgres user
  and password to `postgres`.
- **No TLS.** The server speaks plain HTTP on port 7008, which compose
  publishes on the host.
- **Integration secrets sit next to the app.** `secretsSettings.storage` is
  `dotenv` by default, so the credentials openroadie holds for the systems you
  connect are only as protected as the host filesystem.

## Before you expose an instance

At minimum: replace the auth key with a generated secret, set a real Postgres
password, put the server behind TLS, restrict which ports the host publishes,
and decide how integration secrets are stored. The
[standalone distribution](docs/standalone-distribution.md) template is a better
starting point for a real deployment than this compose file — it takes its auth
secret and database URL from the environment rather than carrying literals.

If you believe you have found a vulnerability, see [SECURITY.md](SECURITY.md).
Note that a report that an instance running these defaults is unauthenticated
describes this document rather than a vulnerability.
