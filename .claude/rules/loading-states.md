# Loading States

One standard for how the app shows "still loading" — so pages stop inventing
their own. Applies when editing any page/route that fetches data or is code-split
(`packages/app/`).

## Principles

1. **Skeleton, not spinner, for anything with a known shape.** If the result is a
   table, a list of cards, or a form, show a skeleton that mirrors that layout.
   Spinners are only for inline/indeterminate waits (a busy button, a refresh
   icon) — never for a whole page or section.
2. **Chrome never disappears.** Render the page header (or its skeleton)
   immediately; only the content area swaps to a skeleton. Never blank the title
   - primary action behind a full-page loader.
3. **The two phases must match.** A route has two loading moments — the route-level
   Suspense fallback (JS chunk loading) and the in-component data fetch. Both must
   render the **same** skeleton so the transition is seamless. Never
   spinner-then-skeleton or generic-box-then-table.
4. **Mirror the real dimensions.** Skeletons reserve the final layout's sizing
   (column widths, row height, card size) to avoid layout shift on data arrival.
5. **First load only.** Show the skeleton when there is no data yet. On
   refetch/filter/paginate with data already on screen, keep the content and use a
   subtle inline indicator — don't flash a skeleton. **Both halves are required**:
   keeping stale content _without_ an indicator leaves the user with a page that
   looks idle while a request is in flight. Expose the two states separately from
   your data hook — `loading` for a true first load, `refreshing` for a fetch with
   data already up (see `use-data-source-objects.ts`).

   The indicator belongs **on the content that is going stale**, not in the page
   header — a header chip reads as chrome and doesn't say _what_ is reloading.
   Two shapes, by what triggered the fetch:
   - **A control triggered it** (a refresh button, a row's "materialize" action):
     spin the icon inside that control — `motion-icon-spin` on its `RefreshCw`.
     See `mcp-audit-log-page.tsx` and `context-groups-columns.tsx`.
   - **No single control did** (sort, filter, paginate): overlay `RefreshingPill`
     from `components/common` (a `role="status"` spinner + "Loading…") on the
     content region, absolutely positioned. The graph views anchor it `top-3
right-3` over their canvas; the objects table uses `bottom-3 right-3`,
     because its `thead` is sticky and a top overlay would cover a column header.

6. **Never flicker.** A skeleton that appears and vanishes within a few hundred
   ms reads as a glitch. Gate it: skip it entirely for fast loads and, once shown,
   keep it up long enough to look intentional. `OverviewTable` does this for you.
   For other loading gates, wrap the loading boolean in `useDelayedFlag`
   (delay-before-show + minimum-visible); route-level Suspense fallbacks are
   delayed by `RouteAdaptiveSuspense` so a fast chunk load shows nothing.

## The two phases

| Phase                | Where                                                                            | How                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1 — route chunk load | `RouteAdaptiveSuspense` (`common/route-adaptive-suspense.tsx`), wraps all routes | For overview tables, add the path to `OVERVIEW_TABLE_ROUTES`. Everything else gets `DefaultRouteSuspenseFallback`. |
| 2 — data fetch       | the page component                                                               | Gate on your data hook's `loading`. `OverviewTable` does this for you — pass `loading`.                            |

## Page archetype → pattern

| Archetype                     | Component                           | Loading pattern                                                                                                                                                                      |
| ----------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Overview table / listing**  | `OverviewTable`                     | Table skeleton (`OverviewTableLoadingView`) in **both** phases. Route: register in `OVERVIEW_TABLE_ROUTES`. In-component: pass `loading`. **Never a spinner or a bespoke skeleton.** |
| **Card list / grid**          | card list                           | `CardListLoadingView` (N placeholder cards). Render inside the real `Card`/`CardContent`.                                                                                            |
| **Form / single detail card** | `Card` + form                       | `FormLoadingView` (labeled field skeletons). Render inside the real `Card`/`CardContent` so the header stays put.                                                                    |
| **Bare table (in a Card)**    | `@roadiehq/ui` `<Table>`            | Keep the real `<TableHeader>`; render `TableBodySkeleton` as the body. (Listings use `OverviewTableLoadingView` instead.)                                                            |
| **Master / detail split**     | two panes                           | A skeleton per pane (list rows on the left, a detail block on the right).                                                                                                            |
| **Inline / action busy**      | Button, refresh icon, dialog submit | `Spinner` inside the control, or `animate-spin` on the icon. Correct use of a spinner — it never replaces the section.                                                               |

Most shared skeleton primitives live in `components/common` (`OverviewListingPageHeaderSkeleton`, `FormLoadingView`, `CardListLoadingView`, `TableBodySkeleton`, `DetailDrawerSkeleton`, `RefreshingPill`). `OverviewTableLoadingView` is the exception — it lives in `components/overview` and is exported from that barrel, because it depends on the overview table's shell and column tokens.

A listing that hand-rolls its table instead of using `OverviewTable` (the
datastore objects table is the one case) still follows the overview-table row
above: register the route in `OVERVIEW_TABLE_ROUTES` and use `TableBodySkeleton`
for phase 2. Owning the table is not a reason to invent a loading story.

`TableBodySkeleton` takes `cellClassName` / `barClassName`: a table whose cells
aren't the default `p-2` must pass its own row metrics, or the rows come out
taller than the real ones and the table shifts when data lands (principle #4).

## Adding a new overview-table route (the common case)

1. Build the page with `OverviewTable`; pass its `loading` prop.
2. Export a `COLUMN_WIDTHS` array from your page's `*-table-layout.ts`, built from
   the same width classes the live columns use — that shared array is what makes
   the skeleton's columns line up instead of splitting evenly.
3. In `route-adaptive-suspense.tsx`, add the path to `OVERVIEW_TABLE_ROUTES`:

   ```ts
   '/my-page': { columnWidths: MY_PAGE_COLUMN_WIDTHS, hasRowActions: true },
   // pageScroll: true if paginate={false}
   ```

   `columnWidths` may instead be a `(searchParams) => string[]` resolver when the
   column set depends on the URL — `/integrations` keys off `?group=`, and
   `/datastore` off its `?ds=` scope.

   Both phases now show the same table skeleton automatically. Nothing else.

## Do / Don't

- **Do** render `OverviewListingPageHeaderSkeleton` (or the real header) first.
- **Do** reuse the shared skeleton for the archetype; don't hand-roll a one-off.
- **Don't** use a full-section `Spinner` / centered loader for shaped content.
  (There is deliberately no shared "centered page spinner" primitive.)
- **Don't** let a route's Suspense fallback differ from the skeleton the page
  shows once its chunk loads.

## Remaining exceptions

Every sidebar overview table, plus the admin form/list/table pages, now follow
the archetypes above. These intentionally differ:

- **MCP Audit Log** (`mcp-audit-log-page.tsx`) — a local `LoadingSkeleton()`
  (header bars plus repeated row bars) rather than a shared primitive. Already
  skeleton-based, so it satisfies principle #1; it is a candidate to fold into
  `OverviewListingPageHeaderSkeleton` + `TableBodySkeleton` rather than a
  documented exception.
- **Datastore graph** (`datastore-graph-page.tsx`) — two SVG graph modes
  (object ego view / A↔B paths). Header, mode switcher
  and filters always render; only the canvas shows a centered spinner, and
  only on first load — param changes keep the previous graph on screen
  (`keepPreviousData`) with the small "Loading…" pill
  (`GraphRefreshingPill`, a thin wrapper over the shared `RefreshingPill`),
  per principle #5. No skeleton: node count and
  positions are unknowable before data, so a fake ring/circle skeleton would
  misrepresent the shape and shift on arrival (principle #4).

Not an exception: the `Spinner` in `relationships/relationships-page.tsx` is a
save-status indicator, not a loading gate — that is the inline/action-busy
archetype.
