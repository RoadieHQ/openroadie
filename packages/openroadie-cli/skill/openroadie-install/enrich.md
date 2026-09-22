# Enrich the catalog — optional but recommended

Reach for this **after relationships are built**, when the user wants more than a bare queryable
catalog. Each step is independent — offer them, do the ones the user wants, skip the rest. A catalog
with none of these still works; these make an agent's answers richer.

## Capabilities — reusable instruction sets

A capability is a documented procedure an agent can fetch and follow later (`{name, description,
instructions}` in markdown). Seeding one or two turns the catalog into shared institutional memory so
the next agent run follows a vetted process instead of re-deriving it.

```bash
openroadie capabilities create \
  --name "Onboard a new service" \
  --description "How to register a service in the catalog" \
  --instructions "1. Add catalog-info.yaml  2. Connect the repo  3. Verify it indexes"
openroadie capabilities list
```

Ask the user what procedures their team repeats, and capture those — don't invent generic ones.

## Context groups — pre-materialized clusters

A context-group rule names a set of **datasources**; each of their objects becomes a group, and
objects connected by the optional **merge relationship types** are folded into one group. Merging
only pays off **after** relationships exist — with no edges every object stays its own group. Once
materialized, one agent query returns a whole bundle (a person + their GitHub/Shortcut/PagerDuty
identities merged by `samePerson`) instead of a manual graph walk.

```bash
# datasource UUIDs are the ingestion-workflow ids the relationship rules use
openroadie context-groups create \
  --name "People across systems" \
  --description "A person and their identities across tools" \
  --datasource <person-source-uuid> <other-person-source-uuid> \
  --merge samePerson
openroadie context-groups list
```

Build the rule from the relationships you just approved — a `--merge` type must match a relationship
that actually exists, or nothing merges.
