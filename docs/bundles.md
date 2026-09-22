## Shareable bundles

A bundle is a directory of YAML manifests describing a working OpenRoadie setup — data sources, relationship rules, context groups, capabilities, actions and the integrations they need. `openroadie bundle export` writes one; `openroadie bundle import` recreates it somewhere else.

The `openroadie` CLI runs from source — see [Build the `openroadie` CLI](./getting-started.md#build-the-openroadie-cli).

The point is to share a configuration through a plain git repo instead of hand-rebuilding it or dumping the database. [RoadieHQ/openroadie-examples](https://github.com/RoadieHQ/openroadie-examples) is a collection of bundles built this way.

Bundles carry configuration by default. Add `--include-data` when a demo bundle should also carry the objects currently stored for its data sources.

### The contract

Every manifest is a Kubernetes-style file:

```yaml
apiVersion: roadie.io/v1
kind: ContextGroup
metadata:
  slug: pod-to-change-prod-diagnosis
  name: Pod to change (prod diagnosis)
spec:
  datasources:
    - datasourceSlug: k8s-pods
```

Files are laid out one directory per kind, plus a `bundle.yaml` at the root:

| Kind                 | Directory               |
| -------------------- | ----------------------- |
| `DataSource`         | `datasources/`          |
| `DirectRelationship` | `direct-relationships/` |
| `RelationshipRule`   | `relationship-rules/`   |
| `ContextGroup`       | `context-groups/`       |
| `Capability`         | `capabilities/`         |
| `Action`             | `actions/`              |
| `Integration`        | `integrations/`         |

`bundle.yaml` holds the bundle's name and its **prerequisites** — the integrations the bundle needs but does not itself create.

**UUIDs never travel.** Every cross-reference is a slug: workflow nodes and action steps carry `integrationSlug`, rules carry `sourceDatasourceSlug`/`targetDatasourceSlug`, context-group filters carry `datasourceSlug`, and a capability's `@type:slug` references pass through untouched. That is what lets a bundle import into an environment whose database ids are entirely different.

**Secrets never travel.** Integration stubs keep their `${SECRET_REF}` placeholders, and export warns if an auth config has no placeholder or if a value under a credential-shaped key looks literal. The warning is a heuristic, not a guarantee — read the diff before you push a bundle to a public repo.

Built-in integrations (`createdBy: system`) are never exported; they are recorded as prerequisites by slug instead. User-created integrations export as `kind: Integration` stubs so the importer can recreate them and be told which secrets to set.

#### Versioning

`apiVersion` is `roadie.io/v1`. The group is a DNS name Roadie controls, so manifests defined by different vendors can never collide.

Additive, backward-compatible changes (a new kind, a new optional field) keep `v1`. Anything that would make an older CLI misread a bundle bumps the version. Import checks `bundle.yaml`'s `apiVersion` **before** validating anything else and refuses a bundle whose version it does not recognise, rather than importing whichever files happen to still parse.

### Exporting

```bash
openroadie bundle export -o ./my-bundle
```

With no roots that is a full dump of every exportable structure. Name roots to cherry-pick:

| Flag                        | Selects                          |
| --------------------------- | -------------------------------- |
| `--datasource <slug...>`    | Data sources by slug             |
| `--context-group <slug...>` | Context groups by slug           |
| `--capability <slug...>`    | Capabilities by slug             |
| `--rule <idOrName...>`      | Relationship rules by id or name |
| `-o, --out <dir>`           | Output directory (required)      |
| `--include-data`            | Include stored objects           |

From those roots the exporter walks the dependency graph: a context group pulls the data sources it filters on, a rule pulls the two data sources it joins, and rules between two included data sources come along. Opt out with `--no-follow-datasources` and `--no-follow-rules`.

```bash
openroadie bundle export --context-group pod-to-change-prod-diagnosis -o ./my-bundle
```

A row that cannot be exported — a rule pointing at a deleted data source, say — is skipped with a warning rather than failing the whole export. Re-exporting into an existing directory prunes manifests the new selection no longer emits, so the directory always reflects one export rather than accumulating orphans.

### Importing

```bash
openroadie bundle import ./my-bundle --dry-run
```

Always dry-run first. It prints the plan — one action per item — and writes nothing:

| Action                | Meaning                                                          |
| --------------------- | ---------------------------------------------------------------- |
| `create`              | Does not exist on the target; will be created                    |
| `overwrite`           | Exists; will be replaced (`--force` only)                        |
| `skip-existing`       | Exists; will be left alone (`--skip-existing`, and integrations) |
| `conflict`            | Exists and no collision mode was chosen — import is blocked      |
| `skip-missing-prereq` | Needs an integration or data source that is not present          |
| `excluded`            | Filtered out by `--only`/`--exclude`                             |

| Flag                  | Effect                                                   |
| --------------------- | -------------------------------------------------------- |
| `--dry-run`           | Print the plan, write nothing                            |
| `--only <item...>`    | Import only these items, as `<kind-dir>/<slug>`          |
| `--exclude <item...>` | Skip these items, as `<kind-dir>/<slug>`                 |
| `--force`             | Overwrite items that already exist                       |
| `--skip-existing`     | Skip items that already exist (conflicts with `--force`) |

By default a collision **fails** the import rather than guessing: `--force` and `--skip-existing` are opposite instructions for the same situation, so the CLI makes you pick one.

Two behaviours worth knowing:

- **Integrations are create-only, even under `--force`.** A stub carries placeholder auth, so overwriting an integration that already works would clobber live credentials.
- **Relationship rules collide by their matching tuple, not by name.** Rule names are not unique, and a rule has no slug in the database.

Items are written in dependency order — integrations, data sources, rules, context groups, actions, capabilities — resolving slugs to ids created earlier in the same run. Active rules are then applied and context groups materialized. A single failed item is reported and skipped; the rest proceed.

The report ends with what is left to do: which integrations still need credentials, and which data sources need a run to populate objects.

### What does not travel by default

A bundle is configuration only. Deliberate gaps, in rough order of how often they surprise people:

- **Objects.** They are omitted unless export uses `--include-data`. An included snapshot is restored without running the data source, which is useful for demos that should not need credentials.
- **Hand-asserted relationships.** They travel with `--include-data`, after their referenced object snapshots. They are omitted from configuration-only exports.
- **Org-specific values.** Paths baked into a data source (`/orgs/acme/repos`) travel as-is. There is no parameterization yet — expect to edit them after import.
- **Rule state.** A full export includes `suggested` rules, which is usually not what you want to share. There is no state filter yet.

### Troubleshooting

- **`bundle.yaml declares apiVersion "X" but this openroadie CLI understands "Y"`**: the bundle and the CLI disagree on the format version, and nothing was imported. Either re-export the bundle with this CLI, or use a CLI that supports the version the bundle declares.
- **Import blocked by conflicts**: the items already exist on the target. Re-run with `--force` to overwrite or `--skip-existing` to leave them alone.
- **`no bundle item matches: <key>`**: a mistyped `--only`/`--exclude`. Keys are `<kind-dir>/<slug>`, e.g. `capabilities/triage` — the directory name, not the kind.
- **Items report `skip-missing-prereq`**: the bundle references an integration or data source that neither exists on the target nor arrives in the bundle. Configure the prerequisite listed in `bundle.yaml`, then re-import.
- **A data source imported but its node has no integration**: the integration was not available at import time. Configuring it afterwards is not enough on its own — re-import with `--force` to rebind the node.
