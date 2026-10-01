# openroadie

**An organisational context store and control platform for AI agents. You bring your own agents.**

openroadie is not an agent builder. It's the layer your agents plug into so they understand your organisation and can act safely within it.

If you're giving AI agents real access inside your organisation, you need both good context and tight control. That's what we built openroadie for. It builds a self-hosted graph of your organisation from the tools you already use, serves it to agents over MCP, and limits them to the deterministic actions you define, scoped to the user or service driving each agent.

---

## Why

To do real work, like triaging an incident, turning a bug ticket into a PR or finding who owns a failing service, an agent needs to know how your org fits together: which repo deploys which service, who is on call for it, which alerts and tickets point at it. That information is spread across a dozen SaaS APIs. Most setups either give the agent a raw API token for each one or paste context in by hand.

openroadie indexes that metadata ahead of time, keeps it fresh on a schedule and exposes it through one tokenised MCP endpoint. Writes go through deterministic actions that an admin has defined, so the agent picks an action and fills in its parameters rather than composing arbitrary API calls. Access to actions, capabilities, context groups and data is scoped per caller, so an agent working for an on-call engineer and one running in CI can see and do different things.

## Features

- **40 integrations out of the box.** GitHub, GitLab, Bitbucket, Jira, Linear, Shortcut, Slack, PagerDuty, incident.io, Rootly, Datadog, Dynatrace, Sentry, Snyk, Wiz, SonarQube, AWS, GCP, Azure, Kubernetes, Argo CD, Terraform Cloud, Okta, Microsoft Graph and more. Any other HTTP or GraphQL API can be added as a custom integration from the setup wizard, `openroadie integrations create` or the web UI.
- **Scheduled ingestion pipelines.** Each data source is a pipeline (fetch → transform → store) that runs on a cron schedule. Data is processed page by page through Postgres, so memory use stays flat no matter how large the dataset is.
- **Observed, not declared.** Raw data from each service is stored as JSON as it arrives, with no model to define up front. Schemas are inferred, trigram full-text search covers everything, and rules then build the relationships and group concepts together.
- **Relationship graph.** Objects are linked across sources (`github.repo` → `pagerduty.service` → `okta.user`) by a mix of curated relations and automated processes. You write declarative rules by hand where you know the join, and an automated suggester profiles your data and proposes candidate joins with confidence scores for review. Rules can also call an integration to resolve a match, and they re-apply automatically whenever the data changes.
- **MCP server.** Tools are grouped (`explore` read-only, `manage`, `actions`, `integrations`), each group can be switched on or off, and every tool call runs with the caller's own identity.
- **Deterministic actions.** An action is a versioned, schema-validated sequence of steps, and each step can call a different integration and use earlier steps' outputs (e.g. look up a service's owner in PagerDuty, then open a GitHub issue and post to Slack). The agent supplies only the parameters, and inputs are validated and escaped, so the same inputs always run the same steps.
- **Scoped access.** Every REST route and MCP tool checks a `resource:verb[:target]` scope (e.g. `action:execute:restart-pod`), resolved from the user or service token driving the agent. Tools the caller can't use aren't listed, and lists are filtered to the actions, capabilities and context groups they've been granted. The open-source build ships with an allow-all resolver, so you plug in your own to enforce per-caller grants.
- **Capabilities.** Versioned, reusable instruction sets ("playbooks") that agents can discover and follow.
- **Context groups.** Collapse objects from different services into one higher-level concept. For example, a PagerDuty user and a GitHub user become a single "Employee", or a repo, its on-call service and its alerts become one "Service". Groups are precomputed, so a single call returns the whole bundle.
- **Audit log and metrics.** Every MCP tool call is logged with sensitive values redacted. Prometheus metrics are included.
- **Portable config.** Data sources, rules, context groups, capabilities and actions export as YAML manifests that you can commit to git and import into another environment.
- **Web UI and CLI.** Use the React portal for browsing the graph and reviewing rules.
- **Self-hosted.** One Node.js process plus Postgres. Run it on a laptop, a Mac Mini, a VM or your own infrastructure.

## Quickstart

**Prerequisites:** Node.js 22.22+ (or 24+), `yarn`, Docker (for Postgres)

```bash
docker run -d --name openroadie-dev-db -p 5432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16
yarn install
yarn dev
```

- UI: http://localhost:3333
- API: http://localhost:7008

Create datasources, capabilities, actions, relationships and point your agent at the MCP endpoint found on the following page:

```text
http://localhost:3333/admin/mcp-servers
```

## How it works

```mermaid
flowchart LR
    SRC["Data sources<br/>GitHub · Datadog · AWS · …"]

    subgraph or["openroadie"]
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

- **Data plane:** connectors ingest metadata on a schedule into a Postgres-backed store, and a rules engine links objects into a graph.
- **Control plane:** curated actions and read tools are exposed through tokenised MCP servers, so each tool runs with the caller's permissions.

## Deployment

On your laptop, openroadie only ingests data while the machine is awake. For always-on ingestion, and to trigger agents from Slack, GitHub or Datadog webhooks, run it on a server. There is a `Dockerfile` and a `docker-compose.yml` (openroadie plus Postgres 16). openroadie currently runs from source. There is no published container image or npm package yet.

## Background

openroadie grew out of a long-running internal project at [Roadie](https://roadie.io), a hosted developer portal built on Spotify's [Backstage](https://backstage.io). It keeps Backstage's plugin-based, dependency-injected backend architecture. Backstage is not required, and openroadie does not depend on it.

## Contributing

Issues and PRs are welcome. Come say hello on [Discord](https://discord.com/invite/3NybApFpUU). See [CONTRIBUTING.md](./CONTRIBUTING.md) for conventions and [SECURITY.md](./SECURITY.md) for reporting vulnerabilities.

## License

[Apache 2.0](./LICENSE)
