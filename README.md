# openroadie

Open-source context store and agentic control platform. Connect your data, build guardrails, then let your agents run wild.

---

Openroadie turns your organisational metadata about your software into a self-hosted, always-on context layer for you and your team. You can then attach and bound actions that are permissible for any agent to execute, then wrap everything in tokenised MCP servers.

Openroadie is a control center designed to curate context for any agentic task — like triaging incidents and publishing findings to Slack or turning bug tickets into PRs.

It runs locally on your machine by default, but can run in a Docker container, on VMs, or within your company infrastructure.

**Quickstart**

You can install **openroadie** to run on any machine: on your laptop, on a dedicated computer like a Mac Mini, or on a server in the cloud.

The most powerful way to run **openroadie** is on a server in the cloud. This allows data ingestion to continue running even when your laptop is shut, and makes it easier to trigger your agents through third-party services like Slack, GitHub, and Datadog. See the self-hosting guide for details, especially with respect to security hardening.

**Install**

Full walk-through: [Getting started with openroadie](./docs/getting-started.md).

The first question is whether you want to run **openroadie** under Docker or directly on the machine. Both give you the same portal — UI and API on a single port, http://localhost:7008.

**With Docker (recommended)**

**Prerequisites**: Node.js 22.12.x or later, Docker (with the compose plugin)

```
npx @roadiehq/openroadie-cli up
```

This pulls the published **openroadie** server image plus a PostgreSQL container, starts both with Docker Compose, and waits until the server reports ready. Then connect your tools and build your context graph:

```
npx @roadiehq/openroadie-cli setup    # pick integrations + hand over tokens (they never leave your machine)
npx @roadiehq/openroadie-cli status   # shows where the install stands and the exact next command
```

Or let a coding agent drive the whole install: give it the skill with
`npx skills add RoadieHQ/skills` (works for Claude Code, Codex, Cursor, and most other harnesses),
then tell it to "install openroadie" — it takes the catalog from nothing to live and queryable.
The skill also ships inside the CLI package itself, so `npx @roadiehq/openroadie-cli` works
self-contained.

If you'd rather skip the CLI: `docker pull ghcr.io/roadiehq/openroadie:latest`, or `docker compose up` from a checkout. Releases are tagged `v*`; the npm CLI and the image publish together at matching versions.

**Without Docker**

**Prerequisites**: Node.js 22.12.x or later, a reachable PostgreSQL database

```
npm install -g openroadie
mkdir my-portal && cd my-portal
openroadie init      # scaffolds app-config.yaml + .env (edit DATABASE_URL)
openroadie           # serves the portal on http://localhost:7008
```

One globally-installed package, no containers — bring your own Postgres. Migrations run automatically on startup. By default it binds to `127.0.0.1` with auth disabled; configure authentication before exposing it on a network.

**From Source**

**Warning**

This runs **openroadie** directly on the machine you're installing on.

**Prerequisites**: Node.js 22.12.x or later, `yarn`, `uv` (for running the agent server via `uvx`)

```
git clone https://github.com/RoadieHQ/openroadie.git openroadie
cd openroadie
yarn install
yarn dev
```

---

Access the UI at http://localhost:3333.

Access the backend at http://localhost:7008

**Architecture**

Openroadie grew out of a long-term project inside Roadie, a Developer Portal company, which in turn was based on Spotify’s Backstage open-source Internal Developer Portal.

As such, it inherits some architectural features from those previous applications — notably Backstage's dependency-injection "New Backend System" of composable plugins.

At a glance, OpenRoadie is a single Node.js backend plus Postgres, organised around two planes:

```mermaid
flowchart LR
    SRC["Data sources<br/>GitHub · Datadog · AWS · …"]

    subgraph or["OpenRoadie"]
        direction TB
        DATA["Data plane<br/>integrations → workflows →<br/>datastore + relationship graph"]
        CTRL["Control plane<br/>MCP servers · actions · AI agents"]
        DATA --> CTRL
    end

    AGENTS["AI agents<br/>(tokenised MCP)"]

    SRC -->|ingest| DATA
    CTRL -->|bounded actions| SRC
    AGENTS <-->|MCP| CTRL
```

- **Data plane** — connectors ingest metadata on a schedule into a Postgres-backed context store; a rules engine relates objects into a knowledge graph.
- **Control plane** — curated, guardrailed actions are exposed to agents through tokenised MCP servers, so every tool runs with the caller's own permissions.

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the full breakdown, with layered diagrams of the runtime, backend composition, and both planes.

**Sharing a setup**

A working configuration — data sources, relationship rules, context groups, capabilities — can be exported as a directory of YAML manifests and imported into another environment:

```
npx @roadiehq/openroadie-cli bundle export -o ./my-bundle
npx @roadiehq/openroadie-cli bundle import ./my-bundle --dry-run
```

See [Shareable bundles](./docs/bundles.md) for the format and the full flag reference, and [openroadie-examples](https://github.com/RoadieHQ/openroadie-examples) for ready-made bundles.

**Conventions & Coding Standards**

See `CONTRIBUTING.md` for guidelines on how to contribute to this project.
