# Write-Path Side Effects

How post-write side effects stay wired when a write path gains callers, and
how tests must be shaped to notice when they don't. Applies when adding or
refactoring a caller of a shared write core (a "feeder"), wiring reactions
that follow a write, or writing tests for either.

## Why this rule exists (sc-34243)

The datastore publish was extracted into a shared diff-merge core with two
feeders: the API's `replaceDatasourceItems` and the paged engine's
`StagedPublisher`. The delta-gated side effects — relationship-rule
auto-apply, datasource-changed (context groups, webhooks), the activity
marker — were only wired to the first. When the paged engine became the only
execution path, every data source run silently stopped triggering them for
three weeks. Nothing errored; the data was correct; downstream reactions just
stopped. The parity test of the day compared the two feeders' **end state**,
which was identical — so it passed throughout.

## One choke point per write path

Every reaction that must follow a write lives in ONE method, and every feeder
ends in it. For the datastore publish that method is
`DatastoreRepository.applyPublishSideEffects(datasourceId, delta)`:
`replaceDatasourceItems` calls it inline after its transaction; workflow runs
reach it through the sync event (`WorkflowSyncSubscriber`).

- **Never re-spell the tail in a new feeder.** If a new path writes to the
  datastore, it ends in `applyPublishSideEffects` — directly, or via an event
  that lands there.
- **Never add a reaction beside one feeder.** A new post-publish reaction
  goes inside the choke point, so every feeder gets it for free.
- The same shape applies to any future shared write core: extract the
  side-effect tail into a named method at the same time as the core, and make
  the first caller go through it.

## Parity-test every feeder — side effects included

End-state parity is not enough (see above). `publish-parity.test.ts`
(`plugins/catalog-workflow-data`) has two suites:

- data parity: identical input through both feeders → identical
  datastore/index/schema end state;
- **side-effect parity**: identical transitions (insert, no-op, update,
  delete-only) → identical observations of changed-event, auto-apply
  scheduling, and the activity marker.

Adding feeder N+1 means adding it to both suites. A feeder that cannot be
exercised there needs an e2e invariant instead — and a comment saying so.

## Invariant-shaped tests, not existence tests

Test that derived state **tracks its inputs across changes**, not that it
exists after one operation. "Relations exist after a run" passed through the
entire sc-34243 regression; "relations track the data across re-runs" fails
in seconds. Live examples in `packages/e2e/tests`:

- `relationship-rule-datasource-rerun.spec.ts` — relations survive re-runs
  AND a re-run that changes the match set recomputes them;
- `datasource-run-side-effects.spec.ts` — context groups re-materialize
  after a re-run, an empty first run still reads as synced, a webhook
  delivery follows a changed run.

The recipe: establish a baseline, change the input, drive the system through
its production path (a real run, not a direct DAO call), and assert the
derived state converged. Poll with `expect.poll` — the reactions are
debounced/coalesced on purpose.

## Enumerations become tests

When a design doc, ADR, or commit message enumerates guarantees ("side
effects fire only when delta > 0: activity touch, datasource-changed,
relationship auto-apply"), that list is a test plan — encode it as
assertions in the same change. sc-34102's commit message named all three
side effects; the list never became assertions for the second feeder, and
that gap was exactly where the regression lived.
