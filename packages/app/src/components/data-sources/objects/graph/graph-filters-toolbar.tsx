import { useId } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { Checkbox } from '@roadiehq/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@roadiehq/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@roadiehq/ui/select';
import type { GraphTraversalDirection } from '../../../../api/datastore/datastore-client';
import { RelationshipTypeFilter } from './relationship-type-filter';
import type { GraphViewMode } from './graph-url-state';

export interface GraphEdgeFilterState {
  types: string[];
  dir: GraphTraversalDirection;
}

/**
 * The edge-filter facets shared by every graph mode: relationship types
 * and — in the object view, where edges are walked from a root —
 * traversal direction. Also hosts the context-group collapse toggle, a view
 * option rather than an edge filter, so "Clear" leaves it alone.
 */
export function GraphFiltersToolbar({
  mode,
  availableTypes,
  value,
  onChange,
  expandGroups,
  onExpandGroupsChange,
}: {
  mode: GraphViewMode;
  availableTypes: string[];
  value: GraphEdgeFilterState;
  onChange: (next: GraphEdgeFilterState) => void;
  expandGroups: boolean;
  onExpandGroupsChange: (next: boolean) => void;
}) {
  const activeCount = value.types.length + (value.dir !== 'both' ? 1 : 0);
  const expandGroupsId = useId();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          aria-label={
            activeCount > 0
              ? `Graph filters, ${activeCount} active`
              : 'Graph filters'
          }
          data-testid="graph-filters"
        >
          <SlidersHorizontal className="size-3.5" />
          Filters
          {activeCount > 0 ? (
            <span className="rounded-full bg-muted px-1.5 text-2xs font-medium text-muted-foreground tabular-nums">
              {activeCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-72 p-4">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Graph filters
              </h3>
              <p className="mt-0.5 text-xs text-pretty text-muted-foreground">
                Narrow relationships without changing the selected source.
              </p>
            </div>
            {activeCount > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 shrink-0 gap-1 px-2 text-xs text-muted-foreground"
                onClick={() => onChange({ types: [], dir: 'both' })}
              >
                <X className="size-3.5" />
                Clear
              </Button>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-medium text-foreground">
              Relationship types
            </span>
            <RelationshipTypeFilter
              types={availableTypes}
              value={value.types}
              onChange={types => onChange({ ...value, types })}
              className="w-full [&>button]:h-8"
            />
          </div>

          {mode === 'object' ? (
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-foreground">
                Direction
              </span>
              <Select
                value={value.dir}
                onValueChange={next =>
                  onChange({
                    ...value,
                    dir: next === 'out' || next === 'in' ? next : 'both',
                  })
                }
              >
                <SelectTrigger
                  className="h-8 w-full text-xs"
                  aria-label="Traversal direction"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Both directions</SelectItem>
                  <SelectItem value="out">Outgoing only</SelectItem>
                  <SelectItem value="in">Incoming only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="flex items-center gap-2 border-t border-divider pt-3">
            <Checkbox
              id={expandGroupsId}
              checked={expandGroups}
              onCheckedChange={checked =>
                onExpandGroupsChange(checked === true)
              }
            />
            <label
              htmlFor={expandGroupsId}
              className="cursor-pointer text-xs text-muted-foreground select-none"
            >
              Expand context groups
            </label>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
