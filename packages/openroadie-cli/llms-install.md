# Install openroadie (for a coding agent)

You are installing **openroadie** — a self-hosted software catalog / context graph — for a user.

**Load and follow the skill that ships with this package:**

```
skill/openroadie-install/SKILL.md
```

It is the full procedure: stand the server up (ask the user first: Docker via
`openroadie up`, or the standalone `npm install -g openroadie` package against
their own Postgres), hand off to the user for their own credentials (never touch
a token yourself), index the catalog, build the relationship graph, and verify
with a live query. Drive everything through the `openroadie` CLI — every command
prints a `JSON:` line you parse, and `openroadie status` always tells you the
next step.

Start by reading that skill, then run `openroadie status`.
