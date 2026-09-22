# Getting started with openroadie

This guide takes you from nothing to a live catalog your agents can query: server running,
integrations connected, data indexed, relationships built, and an MCP endpoint your coding agent
can use. Budget 15–30 minutes, most of it waiting for your first ingestion.

## What you're setting up

Openroadie turns your organisational metadata — repos, people, deployments, tickets, alerts —
into a self-hosted context graph. Data flows in from your tools through **integrations**, lands as
objects via **data sources**, gets linked by **relationship rules**, and comes back out through
search, a graph UI, and a **tokenised MCP server** your agents talk to.

## 1. Install — let an agent drive it

The fastest path is to let your coding agent (Claude Code, Codex, Cursor, …) run the whole
install. Give it the skill, then say the word:

```bash
npx skills add RoadieHQ/skills
```

Then tell your agent: **"install openroadie"**. The skill drives everything below — server up
(it asks you Docker-or-not first), integrations, indexing, relationship triage, verification —
and reports back with a live catalog and your MCP config. The credential boundary is built in:
**the agent never sees your tokens.** When it reaches the connect step it hands you off to the
setup wizard (a terminal UI where you pick integrations and paste tokens), and resumes when
you're done.

Two commands you'll meet along the way, agent-led or not:

```bash
openroadie status    # where the install stands + the exact next command
openroadie setup     # the wizard TUI: pick integrations, hand over tokens
```

## Installing manually

Prefer to drive it yourself? Everything the agent does, by hand. First question: Docker or not —
both give you the same portal, UI and API on one port, http://localhost:7008.

### With Docker (recommended)

**Prerequisites**: Node.js 22.12+, Docker with the compose plugin.

```bash
npx @roadiehq/openroadie-cli up
```

This pulls the published server image plus a PostgreSQL container, starts both with Docker
Compose, and waits until the server reports ready (about half a minute on first pull).

### Without Docker

**Prerequisites**: Node.js 22.12+, a reachable PostgreSQL database. The Postgres user needs the
**CREATEDB** privilege — openroadie provisions a database per plugin (`roadie_plugin_*`) from your
connection, so the database named in `DATABASE_URL` itself stays empty. That's expected.

```bash
npm install -g openroadie
mkdir my-portal && cd my-portal
openroadie init      # scaffolds app-config.yaml + .env (generated auth secret)
# edit .env: point DATABASE_URL at your Postgres
openroadie           # serves the portal; migrations run on boot
```

By default it binds `127.0.0.1` with auth disabled — right for local single-user use. Configure
authentication and `backend.listen.host` before exposing it on a network.

> Install **either** the standalone `openroadie` package **or** `@roadiehq/openroadie-cli`
> globally, not both — they share the `openroadie` command name.

The rest of this guide is the manual walk-through of what the agent-led install automates.

## 2. Open the portal

Visit http://localhost:7008 (use `127.0.0.1` if your browser resolves `localhost` to IPv6 and
refuses). You'll land on an empty Relationships canvas — that's a fresh database, not a problem.
The sidebar is your map: **Relationships · Data Sources · Integrations · Capabilities · Actions ·
Context Groups · Administration**.

## 3. Connect your tools

```bash
openroadie setup
```

The wizard lists the available integrations (GitHub, Slack, Datadog, PagerDuty, Snyk, AWS, and
~25 more), lets you pick the ones you use, and takes their tokens — stored in your secrets
settings, never shown to any agent. GitHub note: a plain `GITHUB_TOKEN` personal access token is
enough; a GitHub App works too but isn't required.

Check where you stand at any point:

```bash
openroadie status    # reports the install state and the exact next command
```

## 4. Index your data

```bash
openroadie sources enable --all   # or pick a subset
openroadie index                  # runs the ingestion — object counts per source
```

`index` re-fetches every enabled source live. Run it to (re)ingest data — it is not how you apply
relationship rules (that's `relationships apply`).

## 5. Build the relationship graph

```bash
openroadie relationships suggest
openroadie relationships list     # judge from this — it resolves datasource names
```

The suggester proposes field-matching joins from seeded templates. **Don't blind-approve**: it
over-links, and junk scores as high as real joins. Keep matches on stable keys (`id`, `email`,
`login`); reject generic display-field matches (`name → name`). Then:

```bash
openroadie relationships reject --ids <id1,id2,...>   # all the noise, one call
openroadie relationships approve --all                # what's left are real joins
openroadie graph                                      # see the result
```

Prefer clicking? `openroadie review` opens the portal's review page where you approve/reject each
rule with its confidence and sample matches.

## 6. Verify with a real query

```bash
openroadie query "<a term that appears in your data>"
```

Keyword search, not natural language — query a project name, a person's first name, or a type
like `epic`. A real match proves the graph answers.

## 7. Point your agent at it

```bash
openroadie agent
```

This prints the MCP client config (an HTTP MCP server over your catalog). Drop it into your
agent's MCP settings and it can explore objects, schemas, and relationships directly.

## Going deeper

- **Deeper relationship discovery** — joins the seeds don't cover, key-normalisation transforms,
  direction/verb conventions: install the `openroadie-relationship-builder` skill
  (`npx skills add RoadieHQ/skills`) and let an agent drive it against your MCP server.
- **Capabilities** — reusable instruction sets for agents: `openroadie capabilities create`.
- **Context groups** — pre-materialised clusters so one query returns a whole bundle:
  `openroadie context-groups create` (build them from relationship types that exist — check
  `openroadie relationships list` first).
- **Actions** — bounded, permissible operations agents can execute through the portal.

## Troubleshooting

| Symptom                                                         | Cause / fix                                                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Browser can't reach `localhost:7008`                            | IPv4/IPv6 resolution — use `http://127.0.0.1:7008`.                                                           |
| Port 7008 already in use                                        | Standalone: `APP_CONFIG_backend_listen_port=<port> openroadie` (update baseUrls to match).                    |
| Standalone boot: migration errors mentioning a missing database | Your Postgres user lacks `CREATEDB` — grant it; openroadie provisions per-plugin databases.                   |
| `index` returns 401s                                            | The integration's token isn't set or expired — re-run `openroadie setup` (or `openroadie secret set <NAME>`). |
| `relationships suggest` returns 0 rules                         | Nothing indexed yet, or sources not enabled — run steps 4–5 in order.                                         |
| Blank page after upgrading the server image                     | A stale service worker is serving the old shell — hard-reload / unregister the service worker for the origin. |

## From source (contributors)

```bash
git clone https://github.com/RoadieHQ/openroadie.git && cd openroadie
yarn install
yarn dev     # backend :7008, frontend dev server :3333
```

See `CONTRIBUTING.md` for how to contribute.
