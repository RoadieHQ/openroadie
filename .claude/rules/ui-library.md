---
paths:
  - 'packages/ui/**/*.{ts,tsx}'
---

# UI Library (`@roadiehq/ui`)

Radix UI primitives + Tailwind CSS. Uses `class-variance-authority` (CVA) for variants and `cn()` from `lib/utils` for className composition.

## Component organization

- **Primitives** = single file: `button.tsx`, `input.tsx`, `select.tsx`
- **Composite systems** = directory with barrel: `ai-elements/`, `editor-header/`,
  `item-list/`, `mentions-text-field/`, `resizable-drawer/`, `step-flow/`, `toolbar/`

## Adding a new component

1. Create `packages/ui/src/components/component-name.tsx` (or directory for composites)
2. Add sub-path export in `packages/ui/package.json`:
   ```json
   "./component-name": "./src/components/component-name.tsx"
   ```
3. Add matching `typesVersions` entry

## Available components

Accordion, Advanced Section, Alert, Autocomplete, Badge, Button, Card, Checkbox,
Collapsible, Combobox, Confirmation Dialog, Copy Button, Definition List, Dialog,
Drawer, Dropdown Menu, Editor, Empty State, Form, Form Section, Inline Code,
Input, Label, Multi Combobox, Outlined Input / Number Input / Select / Textarea,
Pagination Footer, Popover, Select, Separator, Sheet, Skeleton, Spinner,
Status Indicator, Switch, Table, Tabs, Textarea, Toaster, Toggle Group, Tooltip.

Composite directories: AI Elements, Editor Header, Item List, Mentions Text
Field, Resizable Drawer, Step Flow, Toolbar.

For a searchable field, use the real components — `Combobox` (free text with a
floating label, for forms), `Autocomplete` (free text over a bare `Input`, with
option groups), or `MultiCombobox` (multi-select). Don't hand-roll
`<Input list>` + `<datalist>`.

## Surfaces

`Card` owns the surface treatment — never hand-roll `bg-card` + border + radius,
and never override `Card`'s radius/shadow at the call site. Three variants:

- **default** — in-page surfaces (`rounded-lg shadow-sm`)
- **`flat`** — the same surface with no shadow, for panels already nested inside
  another surface where a shadow would stack (`rounded-lg`)
- **`floating`** — panels that sit _over_ content: graph toolbars, legends,
  canvas overlays (`rounded-xl shadow-md`)
