# @roadiehq/mcp-catalog-datastore-module

MCP tools for the catalog datastore — datasources, objects, relationships, relationship rules, and
capabilities. The module registers **three separate MCP services**; which tools an agent can reach
depends on which of the three a client is wired to.

## The three services

| Service          | Endpoint suffix            | Purpose                                | Representative tools                                                                                                                                                                                                              |
| ---------------- | -------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **explore**      | `/api/mcp/v1/explore`      | Read-only catalog / graph / context    | `explore_objects_search`, `explore_object_get`, `explore_related_objects_get`, `explore_context_bundle_get`, `explore_relationship_rules_list`, `explore_relationship_rule_preview`, `explore_relationship_rule_dry_run`          |
| **integrations** | `/api/mcp/v1/integrations` | Live proxied calls to external systems | `integrations_list`, `integrations_request_http`, `integrations_request_aws`                                                                                                                                                      |
| **manage**       | `/api/mcp/v1/manage`       | Write / mutation operations            | `manage_datasource_create`, `manage_integration_create`, `manage_relationship_create`, `manage_relationship_rule_create`, `manage_relationship_rule_apply`, `manage_relationship_rule_disable`, `manage_relationship_rule_delete` |

> The split is a safety boundary: an agent handed only `explore` can inspect and dry-run but cannot
> mutate the graph or make live external calls.

## Wiring for authoring + testing relationship rules

Authoring and validating a relationship rule (especially a context-aware **integration-backed**
rule) spans all three services, so a client that only points at `explore` will silently be unable to
finish the job. Wire **all three** — `explore`, `integrations`, and `manage`. A ready-made reference
config lives at the repo root in [`.codex/config.toml`](../../.codex/config.toml):

```toml
[mcp_servers.openroadie]
url = "http://localhost:7008/api/mcp/v1/explore"
enabled = true

[mcp_servers.openroadie-integrations]
url = "http://localhost:7008/api/mcp/v1/integrations"
enabled = true

[mcp_servers.openroadie-manage]
url = "http://localhost:7008/api/mcp/v1/manage"
enabled = true
```

**Restart the MCP client after changing wiring** — the `manage` and `integrations` tool namespaces
only appear once the client reconnects to those endpoints.

## Recommended relationship-rule workflow

The tools are designed to be used in this order, so no step forces a fallback to raw REST or the CLI:

1. `explore_datasources_list` + `explore_schema_get` (explore) — find IDs and
   field shapes.
2. `explore_relationship_rule_preview` (explore) — confirm a field-matching join, or dry-run an **unsaved**
   integration-backed shape by passing `strategy: "integration-backed"` + `integrationConfig`
   (bounded by `sampleLimit`, default 25).
3. `manage_relationship_rule_create` (manage) — create it, defaulting to `state: "suggested"`.
4. `explore_relationship_rule_dry_run` (explore) — dry-run the **saved** rule by id (works for a suggested
   rule; makes the real integration call + `pathExpression` + graph traversal, writes nothing).
5. `manage_relationship_rule_apply` (manage) — once the candidates look right, materialize the edges. The
   rule must be `active` (approve it in the Roadie UI or create it with `state: "active"`).

---

Roadie gives you a hassle-free, fully customisable developer portal. Find out more here: [https://roadie.io](https://roadie.io).
