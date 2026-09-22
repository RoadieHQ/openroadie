import { useMemo } from 'react';
import { ToggleGroup } from '@roadiehq/ui/toggle-group';
import type { GraphViewMode } from './graph-url-state';

/** The two shapes of subgraph the page can show. */
export function GraphModeSwitcher({
  value,
  onChange,
}: {
  value: GraphViewMode;
  onChange: (mode: GraphViewMode) => void;
}) {
  const items = useMemo(
    () => [
      {
        value: 'object' as const,
        label: 'Object',
        tooltip: "One object's neighborhood, ring by ring",
      },
      {
        value: 'paths' as const,
        label: 'Paths',
        tooltip: 'Every path between two objects',
      },
    ],
    [],
  );
  return (
    <ToggleGroup
      value={value}
      onValueChange={onChange}
      items={items}
      size="sm"
      aria-label="Graph view mode"
      data-testid="graph-mode-switcher"
    />
  );
}
