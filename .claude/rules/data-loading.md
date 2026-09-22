# Data Loading

How the app talks to the API: **TanStack React Query v5** for all server state.
Applies to anything in `packages/app` that reads from or writes to the backend —
hooks, pages, editors, dialogs.

## When this applies

If a component or hook fetches data, mutates data, or caches a server response,
these rules apply. They do **not** apply to browser/UI state (localStorage,
debounce, DOM measurements) — see "Not server state" below.

## The stack

- **Query definitions live in `src/api/queries.ts`.** Query keys and
  `queryOptions` factories are centralised there so pages and the sidebar
  reference the same cache entries (dedupe) and mutations invalidate by key.
- **API clients** come from `ApiContext` hooks (`useWorkflows`, `useDatastore`,
  `useActions`, …). A factory closes over the client:
  ```ts
  export function capabilityDetailQuery(api: CapabilitiesClient, id: string) {
    return queryOptions({
      queryKey: queryKeys.capabilityDetail(id),
      queryFn: async () => (await api.get(id)) ?? null,
    });
  }
  ```
- **Global defaults** live in `src/api/query-client.ts`: `staleTime: 30_000`
  (cached data shows instantly on navigation and refreshes in the background —
  the 0 default would refetch on every mount), `refetchOnWindowFocus: false`,
  `retry: 1`. Override per-query only with reason (e.g. `staleTime: Infinity` for
  the immutable logo catalog).

## Reads → `useQuery`

```ts
const { data, isLoading, error } = useQuery({
  ...capabilityDetailQuery(api, id ?? ''),
  enabled: !isNew && !!id,
});
```

- **Always go through a `queries.ts` factory** for shared / cross-page reads.
  Editor-local one-off reads may inline `useQuery` with an inline key, but the
  key still follows the rules below.
- **`enabled`** gates conditional fetches (new/absent id, a feature toggle).
  Don't early-return a fake empty payload from the `queryFn`.
- **`isLoading`** is the first-load flag. On refetch/paginate, prefer keeping
  content (see keepPreviousData) over a skeleton — this is loading-states rule #5.
- Coalesce `error ?? undefined` at the hook boundary if callers expect
  `Error | undefined`.

### Query keys

- Arrays, hierarchical: `['capabilities', 'detail', id]`.
- **Every input the query depends on goes in the key** — id, pagination, sort,
  serialized filters, a refresh nonce. Different inputs → different cache entry.
- Build them in `queryKeys` (the central map) so mutations can invalidate by
  prefix: `invalidateQueries({ queryKey: ['workflows', 'executions'] })`.

### The `undefined` gotcha

A React Query `queryFn` must **never** resolve to `undefined` (the query would
never settle). API `get`s that return `undefined` on 404 must coalesce:
`queryFn: async () => (await api.get(id)) ?? null`.

### Paginated / filterable tables

React Query's **keyed cache already removes the need for hand-rolled request-id
race guards** — a stale response lands on its own key and can't overwrite the
active one. To also avoid flashing empty while the next page/sort/filter loads:

- `placeholderData: keepPreviousData` keeps the last page visible **during
  loading** — the simplest option, and enough for most tables.
- **Caveat (verified):** `placeholderData` only spans the _pending_ phase and
  **drops on error** — `data` becomes `undefined` when the refetch fails. If you
  need to keep rows on a _failed_ refetch (and/or blank only on a specific input
  change like a data-source switch rather than on every param change), keep a
  small "last good result" ref and fall back to it. `use-data-source-objects.ts`
  does this: it holds the last successful page, keeps it across
  paginate/sort/filter/refresh **and** on a failed refetch, clears it on a
  data-source switch, and drives a first-load-only `loading`.

### `select` for derived data (optional)

`useQuery({ ...factory, select })` lets a component subscribe to a _derived_
slice of the result; combined with structural sharing it re-renders only when
that slice changes, and the transform is cached. Reach for it when a hook is
read by many components or does an expensive transform. It's an optimization,
not a requirement — a `useMemo` over `data` is fine, and correctness beats
shaving re-renders. Today the data-sources hooks use `useMemo`; that's
acceptable.

## Writes

The write rule depends on **what kind of write it is** (this resolves the
apparent tension with `forms.md`):

| Write                                                                       | Pattern                                                                                                             | Loading flag                                   |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Form submit** (create/update behind `form.handleSubmit`)                  | Stay on the form. `await` the API (or a mutation) inside the submit handler; put errors on `form.setError('root')`. | `form.formState.isSubmitting` — see `forms.md` |
| **Non-form write** (delete, restore, materialize, execute, a button action) | `useMutation` with `onSuccess` invalidation                                                                         | `mutation.isPending`                           |

```ts
const deleteMutation = useMutation({
  mutationFn: (id: string) => api.delete(id),
  onSuccess: () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.capabilitiesList }),
});
// expose: deleteX: deleteMutation.mutateAsync, isDeleting: deleteMutation.isPending
```

- **Always invalidate the affected keys in `onSuccess`** (list + detail +
  versions as applicable) rather than manually refetching — the mounted queries
  refetch themselves (stale-while-revalidate).
- **Return the `invalidateQueries` promise from `onSuccess`** (`onSuccess: () =>
queryClient.invalidateQueries(...)`, no braces / `return`). React Query then
  keeps the mutation `isPending` until the refetch settles, so the button stays
  disabled until the list is fresh. Dropping the return is fire-and-forget.
- **Keep only cache logic (invalidation) in the `useMutation` `onSuccess`.** Put
  UI side-effects (navigate, toast) at the call site — inside `handleSubmit`, or
  in the `mutate(vars, { onSuccess })` callback — so they respect unmount and
  keep the hook reusable.
- **Prefer `mutate` + callbacks over `mutateAsync`.** `mutateAsync` rejects, so
  every call needs a `try/catch` or it's an unhandled rejection. Use it only when
  you must `await` to sequence follow-up work (e.g. `await mutateAsync()` then
  `navigate()`), and always wrap it.
- Thin `useCallback` wrappers over `mutateAsync` are fine to preserve a calling
  convention (argless, optional arg) or a return value — `mutateAsync` is stable.

## Not server state (leave alone)

- **localStorage / UI state / debounce** — `react-use`'s `useLocalStorage` etc.
  are fine; they are not data fetching. Don't move favorites, last-viewed,
  column-visibility, active-layer-id into React Query.
- **Local edit buffers** (e.g. the direct-relationships pending
  additions/removals in `use-direct-relationships.ts`, merged over fetched
  edges) stay in component state. Reset them only on an **explicit** session
  change (the `resetKey` pattern) or after a successful save — never on a
  `dataUpdatedAt` change, since a background refetch (staleTime /
  refetchOnMount) must not silently discard unsaved edits. And keep only edits
  in the buffer: a buffer that exists but is never written to is dead weight —
  delete it rather than keeping the reset machinery around.

The whole `packages/app` surface is now on this standard — reads through
`useQuery` (shared factories in `queries.ts`, or an inline key for a
single-consumer read), non-form writes through `useMutation`, refreshes through
`invalidateQueries`. A whole-package audit swept every call to the context-hook
clients (`useWorkflows`/`useDatastore`/`useSecrets`/`useActions`/
`useCapabilities`/`useWebhooksApi`/`useFeatureFlags`, plus the MCP-settings,
service-tokens, and AI `agent` clients): the integrations / secrets / webhooks
cluster, the MCP audit log + settings, the context-groups editor, the
data-source editor sub-components, the relationships-editor graph view + rule
editor/transitions/suggestions, the AI-settings and token-name contexts, and the
relationship-rule field-match preview were all migrated. The only remaining
bespoke data paths are the exceptions below.

## Accepted exceptions

- **Live SSE streams** — `use-execution.ts` and `use-data-source-execution.ts`
  are a live SSE stream + interval poll + optimistic local status. Genuinely not
  React Query's domain (like the relationships graph spinner in
  `loading-states.md`). Kept bespoke on purpose.
- **Optimistic overlays that must survive a refetch** — the data-sources
  execution summaries fold each fetched payload into local state to keep a
  monotonic `lastRunAt` and an optimistic "running" status (`use-data-sources.ts`).
  The _fetch_ is `useQuery`; only the merge is a reducer. Reach for this only
  when a pure derivation genuinely can't express the semantics.
- **A loading flag that spans an external round-trip** — the GitHub App
  `installing` state in `github-integration-dialog.tsx` stays local: it covers
  the OAuth popup flow (fetch install link → new tab → `postMessage` back), not
  a single request, so a mutation's `isPending` can't model it. The GitHub API
  calls it brackets are still `useMutation`; only the multi-step flag is local.
- **A write/read that brackets a live SSE run** — `handleRun` in
  `data-sources-graph-view.tsx` starts an execution, `await`s the SSE stream to
  completion, then reads the resulting schema. Like the SSE streams above, this
  is stream-gated, not a single request — kept bespoke.
- **A form submit whose dialog gates its own close** — the AI-settings
  `saveSettings` in `ai-settings-context.tsx` stays a form submit (the read is
  `useQuery`); see the `forms.md` accepted exception for dialogs wrapping a form.
- **Partial-failure batch writes** — `transitionMany` in
  `use-relationship-rule-transitions.ts` uses `Promise.allSettled` to report a
  per-item failure tally a single `useMutation` can't express; it still
  `invalidateQueries(relationshipRules)` after the batch. The single-item
  `transitionRule` is a `useMutation`.
- **A live AI token stream** — `jsonata-expression-field.tsx` consumes
  `agent.stream()` token-by-token (with a `mountedRef` to drop late chunks). A
  streaming generation, not a fetch — like the SSE streams.

## Considered, not adopted

- **`useSuspenseQuery`** — would let route reads throw to the existing
  `RouteAdaptiveSuspense` boundaries and drop `isLoading`/null-checks. Evaluated
  and **rejected** — it would make the loading/error UX _less_ solid, not more:
  - **Editor detail reads can't use it at all** — no `enabled` option, and they
    gate on `enabled` (new-vs-existing id, feature toggles).
  - Even for the eligible **unconditional overview reads**, it dismantles the
    `loading`/`error` contract that all five listing pages + `OverviewTable` are
    built on, and:
    - **loses the min-visible anti-flicker guarantee on first load** —
      `OverviewTable`'s `useDelayedFlag(delay + minVisible)` can't run when the
      component doesn't render until data resolves, and Suspense fallbacks can't
      enforce min-visible (see `loading-states.md`);
    - **replaces scoped inline "Failed to load X" + one-time toast errors with
      the single app-wide full-page `ErrorFallback`**, unless we add per-route
      `QueryErrorResetBoundary` + scoped boundaries (infra we don't have);
    - **can't even remove the old path** — background-refetch errors and mutation
      states (`retry`, `isDeleting`, `executionsLoading`) still need it.
  - Keep using `useQuery` + the two-phase loading story from `loading-states.md`.
- **`select` / render optimizations** — evaluated, not pursued. No measured
  re-render problem; overview pages already memoize (`useOverviewState`,
  `useMemo`). Pure render-opt with no correctness gain — add only if a real
  perf issue shows up.

## Testing

Any hook/component that uses React Query needs a client in context. Wrap renders
in `TestQueryProvider` (from `src/test-utils`, `retry: false`, `gcTime: 0`):

```ts
const renderHook = <R>(cb: () => R) =>
  rtlRenderHook(cb, { wrapper: TestQueryProvider });
// or: render(<Component />, { wrapper: TestQueryProvider });
```

## Anti-patterns

- `useAsync` / `useAsyncRetry` / `useAsyncFn` from `react-use` for **fetching**.
  Use `useQuery` / `useMutation`. **ESLint-enforced**: importing these from
  `react-use` in `packages/app`/`packages/ui` is a `no-restricted-imports`
  error. (`useLocalStorage` and the other `react-use` UI hooks stay allowed.)
  Live SSE streams are the one exception and disable the rule inline with a
  comment — see `use-execution.ts`.
- Hand-rolled `useEffect` + `useState` fetches with `cancelled` flags, request-id
  race guards, or a `nonce`/`revision` refetch counter. React Query owns all of
  this (`enabled`, keyed cache, `invalidateQueries`, `keepPreviousData`).
- A `queryFn` that resolves to `undefined`.
- A query key missing an input the query depends on (stale/incorrect cache).
- Manually refetching after a mutation instead of invalidating by key.
- Tracking a separate `saving`/`loading` `useState` next to a mutation — use
  `isPending` (or `isSubmitting` for form submits).
