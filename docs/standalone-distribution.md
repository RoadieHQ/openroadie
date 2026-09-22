# Standalone distribution: `npm install -g openroadie`

> Status: **Implemented.** OpenRoadie can be assembled into a single, globally-installable npm
> package runnable as `openroadie`. Verified end-to-end (clean tarball install → working portal
>
> - API + migrations on one port). See "As-built notes" at the end for what shipped and the
>   deltas from the original plan.

## Goal

```bash
npm install -g openroadie
openroadie init      # scaffold config in the current directory
openroadie           # serve the full portal (UI + API) on one port
```

A user installs one package, points it at a Postgres database, and gets a working OpenRoadie
developer portal — UI and API served from a single process.

## Verdict

**Feasible without an architectural rewrite.** The hard parts are already in place:

- The backend already bundles to a **single `dist/index.js`** via esbuild (CommonJS, Node target),
  inlining all `@roadiehq/*` workspace source and externalizing a small set of pure-JS runtime deps.
- Runtime deps (`express`, `knex`, `pg`, `pg-format`, aws-sdk) are **pure JS** — no native
  compilation on global install.
- Config is already layerable via `app-config.yaml` + `APP_CONFIG_*` env overrides, and database
  **migrations run automatically on boot**.
- The frontend **already has a runtime config-injection hook** (`<!-- __ROADIE_CONFIG__ -->`
  placeholder + `loadConfig()` preferring a `<script type="roadie/config">` tag over the
  build-time bundled config).

What remains is an **assembly + wiring job**, not a redesign.

## Decisions

| #   | Topic                | Decision                                                                                                                              | Rationale                                                                                                                       |
| --- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Package scope        | **Full portal on one port.** Backend serves the prebuilt SPA + `/api/*` from a single Express process.                                | Same-origin makes the frontend's relative `/api` calls "just work" and removes backend-URL coupling.                            |
| 2   | Frontend config      | **Runtime injection** into the existing `<!-- __ROADIE_CONFIG__ -->` placeholder, emitting a **safe whitelist only**.                 | Prebuilt SPA can't bake user config at publish time; the injection hook already exists. Secrets must never reach the client.    |
| 3   | Database             | **External Postgres**, connection via env/config; migrations on boot.                                                                 | Zero change to the DB layer (`pg`/`pg-format`/migrations stay as-is). "Separate DB is fine."                                    |
| 4   | Config sourcing      | **CWD `app-config.yaml`** + `APP_CONFIG_*`/`DATABASE_URL` env overrides + `openroadie init` to scaffold `app-config.yaml` and `.env`. | Survives a global install (no relative paths); Backstage-familiar; inspectable; demoable.                                       |
| 5   | Publish artifact     | **Dedicated `packages/openroadie` workspace** with an assembly script that emits a clean generated `package.json`.                    | Keeps the dev monorepo private; only the assembled folder is published; explicit about what ships.                              |
| 6   | Migrations discovery | **`packagePathMocks` startup shim** → flat shipped `migrations/<plugin>/`.                                                            | Migrations are resolved at runtime via `require.resolve`; the existing mock map satisfies this without publishing ~27 packages. |
| 7   | Auth/network posture | **No-auth by default, bind `127.0.0.1` only.** Docs/`init` cover enabling auth + binding `0.0.0.0`.                                   | Frictionless local use, safe by default — not network-reachable out of the box.                                                 |
| 8   | Package name         | **`openroadie`** (unscoped).                                                                                                          | Confirmed available on npm (registry returns 404). Matches the exact install/run UX.                                            |

## Codebase findings (what grounds the plan)

### Backend

- Entry: `packages/backend/src/index.ts` → `createRoadieBackend()` (`@roadiehq/backend-defaults`), Express 4.
- Build: `packages/backend/scripts/build.mjs` (esbuild) → `packages/backend/dist/index.js`.
  Bundles all `@roadiehq/*`; externalizes `express`, `knex`, `pg-format`, aws-sdk. Copies
  `feature-flags.json` into `dist/`.
- Default port **7008**. **No static file serving exists today** (`express.static`/`sendFile`/
  `serve-static` not found anywhere) — we must add it.

### Frontend (`packages/app`, Vite)

- `vite-app-config-plugin.ts` inlines the merged `app-config*.yaml` into the JS bundle at build time.
- `packages/app/index.html` contains the placeholder `<!-- __ROADIE_CONFIG__ -->` (line ~43).
- `packages/app/src/api/infrastructure/config.ts`:
  - `loadRuntimeConfig()` reads `script[type="roadie/config"]` and JSON-parses it.
  - `loadConfig()` **prefers runtime config over bundled config** when present.
- Frontend-consumed config keys (the safe whitelist to inject — verify before shipping):
  `app.title`, `app.baseUrl` (→ same-origin), `backend.baseUrl` (→ same-origin), public `auth.*`
  fields (`domain`, `clientId`, `audience`, `organization`), `features.admin`, `scope`/`tenant`,
  `relations.suggestionProducer`, `app.roadieUrl`, `backend.headers`, `organization.name`.
  **Never** inject `backend.database.*`, `backend.auth.keys`, or any integration secret.

### Database & migrations

- `client: pg` only; `pg-format` is Postgres-specific; all migrations are Postgres knex JS.
- Migration directories are resolved **at runtime**, not build time, via
  `resolvePackagePath(name, subpath)` in `packages/extensions-api/src/services/utilities.ts`,
  which calls `require.resolve('<name>/package.json')` then `../<subpath>`.
- `resolvePackagePath` already consults a **`packagePathMocks` map** first — our injection point.

### Runtime file-resolution audit (drives the assembly script)

**Migration dirs needing a `packagePathMocks` entry + shipped files (10):**

| Package                               | Subpath                | Notes                                            |
| ------------------------------------- | ---------------------- | ------------------------------------------------ |
| `@roadiehq/backend-defaults`          | `migrations/scheduler` | subpath, not just `migrations`                   |
| `@roadiehq/catalog-datastore-backend` | `migrations`           | ~28 migrations                                   |
| `@roadiehq/integrations-backend`      | `migrations`           | ~39 migrations **+ `logos/` subdir** (see below) |
| `@roadiehq/catalog-workflow-data`     | `migrations`           | ~18                                              |
| `@roadiehq/secrets-settings-backend`  | `migrations`           | ~9                                               |
| `@roadiehq/roadie-mcp-server`         | `migrations`           | ~5                                               |
| `@roadiehq/mcp-settings-backend`      | `migrations`           | ~5                                               |
| `@roadiehq/capabilities-backend`      | `migrations`           | ~4                                               |
| `@roadiehq/actions-backend`           | `migrations`           | ~4                                               |
| `@roadiehq/ai-backend`                | `migrations`           | structure only, 0 currently                      |

**`__dirname`-relative reads inside shipped migration files (handled for free):**
13 `integrations-backend` migrations do `fs.readFileSync(path.join(__dirname, 'logos', …))` to seed
~28 SVG logos. Because migration `.js` files are **not** bundled — knex `migrate.latest({directory})`
reads them from disk and `require`s them — their `__dirname` resolves to wherever we ship them. So we
just ship `migrations/integrations-backend/` **with its `logos/` subdirectory intact** and point the
mock at it. No migration rewrite needed.

**Safe / no action:** all other runtime `fs` reads are on **user-supplied paths** (config-loader
file sources, TLS cert paths from config, dotenv secret store, workspace `package.json` discovery).

**Static serving:** none exists → we add `express.static` + SPA fallback for the frontend (see step 1).

## Implementation plan (sequenced)

1. **Serve the frontend from the backend.**
   - Add static middleware for the shipped `web/` dir + SPA catch-all to `index.html`, ordered so it
     **does not shadow `/api/*`** (or the healthcheck).
   - At serve time, replace `<!-- __ROADIE_CONFIG__ -->` in `index.html` with
     `<script type="roadie/config">{…safe whitelist…}</script>` derived from the loaded app-config.
   - Ensure Vite `base: '/'` so assets resolve at root.

2. **CLI / `bin` wrapper** (`bin/openroadie.js`, shebang `#!/usr/bin/env node`).
   - `openroadie` (default) → boot the bundle. `openroadie init` → scaffold `app-config.yaml` + `.env`.
   - Flags: `--config <path>`, `--port <n>`, `--version`.
   - Force the listen **host default to `127.0.0.1`** (override via config/flag for real deployments).
   - Optional: accept a single `DATABASE_URL` and map it into the knex `pg` connection.

3. **`packagePathMocks` startup shim** (runs before backend boot).
   - Register a mock for each of the 10 packages above, mapping `(name, subpath)` →
     `join(__dirname, 'migrations', '<plugin>', ...subpath)`.
   - Special-case `backend-defaults` (`migrations/scheduler` subpath) and `integrations-backend`
     (ship `logos/` alongside its migrations).

4. **Assembly script** (in `packages/openroadie`).
   - Gather: backend `dist/index.js`; `vite build` of `packages/app` with a **neutral** bundled
     config (runtime injection overrides it) → `web/`; each plugin's migrations → `migrations/<plugin>/`
     (preserving `integrations-backend/logos/`); `feature-flags.json`.
   - Emit a generated `package.json`: runtime `dependencies` (`express`, `knex`, `pg`, `pg-format`,
     aws-sdk as needed), `bin`, `engines` (`node >=22`), and `files`.

5. **Release pipeline.**
   - CI: build backend bundle → `vite build` app → assemble `packages/openroadie` → `npm publish`.
   - Version tracks the monorepo.

## Open items to verify during build

- **`pg` is present in the published `dependencies`** (knex needs the driver at runtime) and the
  externals list is otherwise complete.
- **Safe-whitelist correctness** — assert no secret keys can leak through config injection (add a test).
- **`aws-sdk` weight** — only DynamoDB/SNS/SQS integrations need it; consider `optionalDependencies` /
  lazy-require so the default install stays lean.
- **Node floor** — bundle targets 22, Docker uses 24; confirm `engines.node` minimum.
- **`integrations-backend` logos** — confirm `__dirname` inside shipped migrations resolves to the
  shipped `migrations/integrations-backend/` dir at runtime (expected, given knex loads them from disk).

## As-built notes

What was implemented (all behind env flags so the normal dev/Docker setup is unaffected):

- **`packages/openroadie/`** — the dedicated publish package: `scripts/assemble.mjs` (builds +
  gathers everything into `out/`), `bin/openroadie.js` (CLI: `serve` / `init` / `--help` /
  `--version`), `templates/app-config.yaml` + `templates/env.example`, `README.md`. `out/` and
  `*.tgz` are gitignored.
- **Frontend serving** — `packages/backend-defaults/src/frontend/serveFrontend.ts`, wired into
  `createRoadieBackend` after `app.use(routes)`, active only when `OPENROADIE_WEB_DIR` is set.
  Injects a safe config whitelist into the `<!-- __ROADIE_CONFIG__ -->` placeholder.
- **Migration shim** — `packages/backend/src/registerStandalonePaths.ts`, active only when
  `OPENROADIE_MIGRATIONS_DIR` is set; reads `migrations/manifest.json` and registers a
  `packagePathMocks` resolver per package. `packagePathMocks` is now re-exported from
  `@roadiehq/extensions-api`.
- **Config root** — `rootConfigServiceFactory` honours `OPENROADIE_CONFIG_ROOT` so config
  discovery does not require a `package.json` in the working directory (the default `findPaths`
  lookup would otherwise throw in an arbitrary CWD). The CLI passes an explicit `--config`.

Runtime env contract set by the CLI: `OPENROADIE_WEB_DIR`, `OPENROADIE_MIGRATIONS_DIR`,
`OPENROADIE_CONFIG_ROOT`, plus `--config`.

Deltas / discoveries from the plan:

- **esbuild externalization had two latent bugs** (`packages/backend/scripts/build.mjs`), fixed
  here because they break a macOS/standalone bundle:
  1. ESM-only packages (e.g. `xml-naming` via `fast-xml-parser`) were wrongly externalized
     because the heuristic used Node's `require.resolve`, which throws for `import`-only exports.
     Now the resolvability probe uses esbuild's own resolver, so installed ESM-only deps get
     bundled and only genuinely-missing optional deps stay external.
  2. `fsevents` (darwin-only, ships a prebuilt `.node` without `binding.gyp`) was being bundled
     and breaking; it is now explicitly externalized by name.
- **`re2` is a hard native dependency** of the bundle (pulled in transitively, required eagerly).
  Installs therefore need npm install scripts enabled (or a prebuilt binary). Environments with
  `npm config ignore-scripts=true` must `npm rebuild re2`. Worth revisiting whether re2 can be
  made optional with a RegExp fallback to keep the install pure-JS.
- **Per-plugin databases**: the backend provisions a database per plugin (`roadie_plugin_<id>`)
  from the supplied connection, so the named database in `DATABASE_URL` will appear to have no
  app tables — that is expected.
- **Bundled frontend fallback config** still carries the build-time `app-config.yaml` (non-secret
  metadata only). Runtime injection always overrides it, but building the SPA with a neutral
  config would be cleaner. Minor follow-up.

## Out of scope / explicitly deferred

- SQLite / embedded database (Postgres-only; pg-specific migrations + `pg-format`).
- Auto-provisioning Postgres via Docker.
- Publishing individual `@roadiehq/*` plugin packages to npm.
