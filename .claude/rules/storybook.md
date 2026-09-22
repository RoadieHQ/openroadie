---
paths:
  - '**/*.stories.tsx'
---

# Storybook

Version: **10.5** — CSF3 format.

With `yarn storybook` running, the Storybook MCP server (`.mcp.json`) provides
story-writing instructions, component docs (never guess props — look them up),
and `run-story-tests`. Stories also run as Vitest browser tests:
`yarn workspace app exec vitest run --project=storybook`.

## File naming

Always `<component-name>.stories.tsx` co-located next to the component.

## Pattern

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { ComponentName } from './component-name';

const meta = {
  title: 'Feature/ComponentName', // PascalCase segments, no spaces (e.g. DataSources/MapBuilder)
  component: ComponentName,
  parameters: {
    layout: 'fullscreen', // omit for small components — 'centered' is the global default
  },
} satisfies Meta<typeof ComponentName>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    onAction: fn(),
  },
};
```
