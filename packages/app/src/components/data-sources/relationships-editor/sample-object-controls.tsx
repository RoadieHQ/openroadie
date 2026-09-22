import { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ListFilter,
  Pin,
  Search,
  X,
} from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { ToggleGroup } from '@roadiehq/ui/toggle-group';
import { Popover, PopoverContent, PopoverTrigger } from '@roadiehq/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';
import { cn } from '@roadiehq/ui/utils';
import { ObjectListPicker } from '../objects/object-list-picker';
import type { SampleFilter } from './sample-selection';

/** Search-and-pin list, backed by the shared object picker. */
function SampleSearchList({
  datasourceId,
  pinnedId,
  onPick,
}: {
  datasourceId: string;
  pinnedId: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <ObjectListPicker
      label="Choose a source example"
      datasourceId={datasourceId}
      objectId={pinnedId ?? ''}
      onObjectIdChange={onPick}
    />
  );
}

/**
 * The sample-selection bar atop the Source preview card. The chosen source
 * object drives every preview column (source → lookup → target), so this is
 * where the author steers "which example flows through the pipeline": step
 * through the sampled objects, narrow to matched/unmatched ones, or pin a
 * specific object by search. The stepper cycles a fill-biased list (objects
 * whose join field is populated come first), and an amber dot flags a sample
 * whose selected field is empty — the usual reason a sample "isn't what I need".
 */
export function SampleObjectControls({
  datasourceId,
  filter,
  onFilterChange,
  counts,
  position,
  total,
  onPrev,
  onNext,
  pinnedId,
  onPin,
  onClearPin,
  pendingEvaluationLabel,
  fieldEmpty,
  fieldLabel,
}: {
  datasourceId: string;
  filter: SampleFilter;
  onFilterChange: (f: SampleFilter) => void;
  counts: { any: number; matched: number; unmatched: number };
  /** 1-based position of the current sample; 0 when there is none. */
  position: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  pinnedId: string | null;
  onPin: (id: string) => void;
  onClearPin: () => void;
  pendingEvaluationLabel?: string;
  fieldEmpty: boolean;
  fieldLabel?: string;
}) {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <div className="flex items-center justify-between gap-1">
      <div className="flex min-w-0 items-center gap-0.5">
        {pinnedId ? (
          <>
            <span className="flex min-w-0 items-center gap-1 rounded bg-primary/10 py-0.5 pr-0.5 pl-1.5 text-2xs font-medium text-primary">
              <Pin className="size-3 shrink-0" />
              Pinned
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Clear pinned object"
                title="Clear pinned object"
                className="size-4 text-primary hover:text-primary [&_svg]:size-3"
                onClick={onClearPin}
              >
                <X />
              </Button>
            </span>
            {pendingEvaluationLabel && (
              <span className="truncate text-2xs text-muted-foreground">
                {pendingEvaluationLabel}
              </span>
            )}
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Previous sample"
              title="Previous sample"
              className="size-6 text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
              disabled={total <= 1 || position <= 1}
              onClick={onPrev}
            >
              <ChevronLeft />
            </Button>
            <span className="min-w-0 truncate text-2xs text-muted-foreground tabular-nums">
              {total > 0 ? `${position}/${total}` : 'No samples yet'}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Next sample"
              title="Next sample"
              className="size-6 text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
              disabled={total <= 1 || position >= total}
              onClick={onNext}
            >
              <ChevronRight />
            </Button>
          </>
        )}
        {fieldEmpty && (
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="ml-0.5 size-1.5 shrink-0 rounded-full bg-warning"
                  aria-label={
                    fieldLabel
                      ? `The ${fieldLabel} field is empty on this object`
                      : 'The selected field is empty on this object'
                  }
                />
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {fieldLabel
                  ? `“${fieldLabel}” is empty on this object`
                  : 'The selected field is empty on this object'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Filter samples"
              title="Filter samples"
              className={cn(
                'relative size-6 [&_svg]:size-3.5',
                filter === 'any'
                  ? 'text-muted-foreground hover:text-foreground'
                  : 'text-foreground',
              )}
            >
              <ListFilter />
              {filter !== 'any' && (
                <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary ring-1 ring-card" />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-2">
            <ToggleGroup<SampleFilter>
              size="sm"
              value={filter}
              onValueChange={onFilterChange}
              items={[
                { value: 'any', label: `All (${counts.any})` },
                { value: 'matched', label: `Matched (${counts.matched})` },
                {
                  value: 'unmatched',
                  label: `Unmatched (${counts.unmatched})`,
                },
              ]}
            />
          </PopoverContent>
        </Popover>

        <Popover open={searchOpen} onOpenChange={setSearchOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Choose a source example"
              title="Choose a source example"
              className="size-6 text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
            >
              <Search />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72">
            <SampleSearchList
              datasourceId={datasourceId}
              pinnedId={pinnedId}
              onPick={id => {
                onPin(id);
                setSearchOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
