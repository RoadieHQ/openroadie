---
paths:
  - 'packages/app/**/*.{ts,tsx}'
---

# Frontend Structure

## Feature directories (`packages/app/src/components/`)

```
feature-name/
├── overview/                    # route: /feature-name
│   ├── feature-page.tsx
│   ├── feature-page.test.tsx
│   ├── feature-page.stories.tsx
│   ├── feature-card.tsx
│   └── index.ts
├── editor/                      # route: /feature-name/:id
│   ├── editor-page.tsx
│   └── index.ts
├── form/                        # complex sub-feature (3+ files)
│   ├── form-dialog.tsx
│   └── index.ts
├── types.ts                     # shared across pages
├── use-feature.ts               # shared hook
└── index.ts                     # re-exports pages
```

## Rules

- Page directories (`overview/`, `editor/`, `detail/`) group route-level components
- Shared types and hooks live at the feature root
- Sub-components are flat — no nested `components/` directories
- Graduate to a directory only when a sub-component has 3+ related files

## Naming

| What           | Convention             | Example                            |
| -------------- | ---------------------- | ---------------------------------- |
| Files          | kebab-case             | `data-source-card.tsx`             |
| Directories    | kebab-case             | `data-sources/overview/`           |
| Components     | PascalCase export      | `export function DataSourceCard()` |
| Hooks          | camelCase `use` prefix | `useDataSources`                   |
| Barrel exports | `index.ts`             | One per directory                  |

## Imports

| Scenario         | Pattern                                        |
| ---------------- | ---------------------------------------------- |
| Cross-package    | `import { Button } from '@roadiehq/ui/button'` |
| Same directory   | `import { Card } from './feature-card'`        |
| Parent directory | `import type { Item } from '../types'`         |
| Icons            | `import { Database } from 'lucide-react'`      |
