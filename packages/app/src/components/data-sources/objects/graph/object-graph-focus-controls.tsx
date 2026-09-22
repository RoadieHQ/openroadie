import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@roadiehq/ui/button';
import { Card } from '@roadiehq/ui/card';
import { ToggleGroup } from '@roadiehq/ui/toggle-group';
import { X } from 'lucide-react';
import { useDatastore } from '../../../../api';
import { objectDetailQuery } from '../../../../api/queries';
import { resolveObjectDisplayName } from '../resolve-object-display-name';
import {
  OBJECT_GRAPH_DEPTH_OPTIONS,
  type ObjectGraphDepth,
  type ObjectGraphFocus,
} from './object-graph-focus';

type DepthValue = '1' | '2' | '3';

interface ObjectGraphFocusControlsProps {
  focus: ObjectGraphFocus;
  depth: ObjectGraphDepth;
  onDepthChange?: (depth: ObjectGraphDepth) => void;
  onClearFocus?: () => void;
}

function depthValue(depth: ObjectGraphDepth): DepthValue {
  switch (depth) {
    case 1:
      return '1';
    case 2:
      return '2';
    case 3:
      return '3';
    default:
      return '2';
  }
}

export function ObjectGraphFocusControls({
  focus,
  depth,
  onDepthChange,
  onClearFocus,
}: ObjectGraphFocusControlsProps) {
  const depthItems = useMemo(
    () =>
      OBJECT_GRAPH_DEPTH_OPTIONS.map(value => ({
        value: depthValue(value),
        label: String(value),
        tooltip: `Show relationships up to depth ${value}`,
      })),
    [],
  );

  const api = useDatastore();
  const { data: focusObject } = useQuery(
    objectDetailQuery(api, focus.datasourceId, focus.objectId),
  );
  const focusName = focusObject
    ? resolveObjectDisplayName(focusObject.object, focus.objectId)
    : focus.objectId;

  return (
    <Card
      data-testid="object-graph-focus-controls"
      variant="floating"
      className="flex w-64 flex-col gap-2 p-2"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-2xs font-medium text-muted-foreground">
          Focused on
        </span>
        <span
          className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground"
          title={`${focus.datasourceId}:${focus.objectId}`}
        >
          {focusName}
        </span>
        {onClearFocus && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 rounded-md text-muted-foreground shadow-none hover:bg-accent hover:text-foreground"
            aria-label="Clear focused object"
            onClick={onClearFocus}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs font-medium text-muted-foreground">
          Depth
        </span>
        <ToggleGroup
          value={depthValue(depth)}
          onValueChange={value => {
            const next = Number(value);
            if (next === 1 || next === 2 || next === 3) {
              onDepthChange?.(next);
            }
          }}
          size="sm"
          items={depthItems}
          aria-label="Object graph depth"
          className="h-7 rounded-md border border-border bg-card p-0.5 [&_button]:rounded-sm [&_button]:border-0 [&_button]:px-2"
        />
      </div>
    </Card>
  );
}
