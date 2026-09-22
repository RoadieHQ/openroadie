# Listing Navigation

How a row in an overview listing gets you to the thing it describes. Applies to
any `OverviewTable` listing in `packages/app`.

## The invariant

Every listing row — in `OverviewTable` and in the bespoke datastore objects
table alike — has **two** targets, and they must not overlap:

| Click                   | Result                                          |
| ----------------------- | ----------------------------------------------- |
| the row (anywhere else) | opens the **detail drawer** (`useDetailDrawer`) |
| the row's **title**     | navigates to the entity's **full-page route**   |

Nothing else in the row navigates. Row actions (the trailing `⋯` menu, toggles,
the favorite star) act in place.

The drawer is read-first and shallow — a look without leaving the list. The title
is the commitment: a real `<a>`, so cmd/middle-click opens a new tab, the status
bar previews the URL, and the browser history is honest. That split is the whole
pattern; a listing that navigates on row click loses the cheap look, and one that
only opens a drawer gives you no linkable destination.

**Both targets must be reachable by keyboard.** The title is an `<a>`, so it is
already a focus stop; the row body needs `tabIndex={0}`, a `focus-visible` ring,
and Enter/Space on `onKeyDown` — otherwise the drawer is mouse-only and keyboard
users can reach a row's full page but never its cheap look. `OverviewTable` does
this whenever `onRowClick` is set; a listing with its own row handler must mirror
it. `jsx-a11y` will not catch a missing handler here, because the handler sits on
the `TableRow` component rather than a bare `tr`.

## Building the title cell

Use `OverviewTitleCell` from `components/overview`:

```tsx
cell: c => (
  <span className="flex min-w-0 items-center gap-3 font-medium text-foreground">
    <IntegrationIconFrame size="group">
      <Sparkles className="size-4 shrink-0 text-primary" />
    </IntegrationIconFrame>
    <OverviewTitleCell to={capabilityDetail(c.id)}>{c.name}</OverviewTitleCell>
  </span>
),
```

- **Route helpers only** — `capabilityDetail(id)`, `actionDetail(id)`, … from
  `config/paths.ts`. Never a template-literal path in a cell.
- **It's a leaf, not a layout.** It owns the title's typography, truncation and
  focus ring. The surrounding flex row — icon frame, logo glyph, favorite star,
  secondary slug line, badges — stays in your `cell`.
- **Omit `to`** for a listing whose rows have no route; it renders plain text.
- **Never add `stopPropagation`.** The shared guard —
  `rowClickFromInteractiveTarget` in `components/overview` — already ignores
  clicks on `a`, `button`, `input`, `select`, `textarea`, `[role="button"]`,
  `[role="menuitem"]` and `[data-no-row-click]`, so the anchor suppresses the
  row's drawer handler on both click and Enter. A hand-rolled `stopPropagation`
  in a cell is a sign someone didn't know about the guard. A listing with its own
  row handler must call that helper rather than re-spell the selector — the two
  copies had already drifted once.
- **Wrapping it in a trigger works.** It forwards its ref and spreads the rest of
  its props onto the rendered element, so it can be the child of a
  `TooltipTrigger asChild` (as the datastore objects table's dense title cell is)
  without losing the trigger's handlers or aria wiring. Keep the trigger on the
  cell itself rather than a wrapper `span`, or keyboard focus stops opening the
  tooltip.

## Testing

Test **both halves**, in the listing's own page test:

- Clicking the **title** navigates (assert the `href` _and_ the resulting
  location) and leaves `queryByRole('dialog')` null.
- Clicking the **row body** opens the drawer and does not navigate. Target the
  `<tr>` (or the cell wrapper), not the title text — clicking the title is now a
  different behaviour, and a test that clicks the name to open the drawer is
  testing the pattern backwards.
- **Keyboard**: focusing the `<tr>` and pressing Enter opens the drawer (assert
  `toHaveFocus()` too, or a non-tabbable row silently passes), and Enter on the
  focused title navigates without opening it.

A test that only asserts the link passes while the drawer _also_ opens, which is
the exact bug this pattern exists to prevent. Assert the negative.

Note that `Link` does not route through a mocked `useNavigate` — assert
navigation with a location probe (`useLocation` rendered into the test tree),
not by spying on `useNavigate`.

## Exceptions

- **Secrets** (`secrets-table.tsx`) — no detail route and no detail drawer, so
  it has neither behaviour. Its title is plain text on purpose. Give it both, or
  neither; never just one.
- **Datastore objects** (`data-source-objects-table.tsx`) — a bespoke table, not
  an `OverviewTable`, so it owns its own row-click handler. That handler calls the
  shared `rowClickFromInteractiveTarget` and mirrors `OverviewTable`'s keyboard
  contract, and the title cell still uses `OverviewTitleCell` (with density
  overrides via `className`), so the invariant and the markup are shared even
  though the table is not.
- **Integrations in the admin embed** — has no row route; the whole name cell is
  a ghost `Button` that opens the edit dialog (`nameAsButton`). The standalone
  `/integrations` page follows the invariant normally.
- **Workspaces** (`workspaces/overview/workspaces-page.tsx`) — a workspace has
  four fields and no page of its own, so it follows the admin-embed treatment
  above: the name is a ghost `Button` opening the edit dialog, and there is no
  drawer. If a workspace ever grows a detail route, it rejoins the invariant.
- **Teams** (`teams/overview/teams-page.tsx`) — like Workspaces, a team has no
  detail route; its name opens the membership dialog and there is no drawer.
