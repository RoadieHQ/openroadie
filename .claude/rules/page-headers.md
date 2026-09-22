# Page Headers

One header per page archetype. Applies to any route-level component in
`packages/app`.

## The two headers

| Archetype                                    | Component                                            |
| -------------------------------------------- | ---------------------------------------------------- |
| **Listing** (`/capabilities`, `/actions`, …) | `OverviewListingPageHeader` from `components/common` |
| **Detail / editor** (`/…/:id`)               | `EditorHeader` from `@roadiehq/ui/editor-header`     |

There is no third. A route that renders its own `<header>` element is the
smell this rule exists to prevent — every hand-rolled one in this codebase's
history was a copy of another, and they drifted from each other within weeks
(container width, icon treatment, a re-implemented back handler).

## The detail rail

`EditorHeader` is a **fixed 70px sticky rail**. Everything a detail page wants
in its header has a slot:

| What                   | Slot                                    |
| ---------------------- | --------------------------------------- |
| entity name            | `title` (renders the page's `h1`)       |
| logo / section icon    | `icon` — wrap in `IntegrationIconFrame` |
| ancestors              | `breadcrumb`                            |
| badges, slug, id chips | `titleAdornment`                        |
| buttons                | `actions` / `trailingActions`           |
| one-line summary       | `description`                           |

Prefer `EntityEditorHeader` (`components/common`) when the page belongs to one
of the sections it knows (`data-sources`, `integrations`, `actions`,
`capabilities`, `context-groups`) — it fills in the breadcrumb, back target and
section icon for you. Reach for the raw `EditorHeader` only when the trail is
deeper than that mapping covers.

Wrap the page in `EntityEditorShell` so the rail, body and background match the
other routes.

### Breadcrumbs

`breadcrumb` takes a string (with `breadcrumbPath`) or an array of
`{ label, to }` for pages nested more than one level deep:

```tsx
breadcrumb={[
  { label: 'Datastore', to: PATHS.DATASTORE },
  { label: dataSourceName, to: dataSourceObjects(datasourceId) },
]}
```

**The trail is ancestors only.** The current page is the `h1` — repeating it as
a final crumb announces the page twice, so no crumb carries `aria-current`.

### Don't

- **Don't hand-roll a `<header>`.** If a slot is missing, add it to
  `EditorHeader` — that is how the multi-level breadcrumb arrived.
- **Don't re-implement back.** `EditorHeader` prefers history-back when an
  in-app entry exists; `backTo` is the fallback target, not a plain link.
- **Don't invent an identity treatment.** The icon is the entity's logo (or its
  section icon) in an `IntegrationIconFrame`. Generated initials, tinted tiles
  and `text-2xl` titles are what the hand-rolled headers used, and they made the
  same entity look like two different things between its drawer and its page.
- **Don't drop the header while loading.** It costs nothing to render — the back
  control and breadcrumb are useful precisely when the body can't render. See
  `loading-states.md` #2.

## Preview drawers

A listing row's drawer is not a page header: it uses `DetailDrawer` from
`components/common`, whose `title` / `subtitle` / `icon` should resolve to the
same values the routed page passes `EditorHeader`. When they disagree, opening
"Open" from the drawer visibly retitles the thing you were just looking at.
