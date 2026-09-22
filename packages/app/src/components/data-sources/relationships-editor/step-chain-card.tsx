import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { Spinner } from '@roadiehq/ui/spinner';
import { Card } from '@roadiehq/ui/card';

/** Preview cell wrapper: shows a loading / error / empty state, else children. */
export function PreviewState({
  loading,
  error,
  emptyText,
  children,
}: {
  loading?: boolean;
  error?: unknown;
  emptyText?: string;
  children?: React.ReactNode;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-2xs text-muted-foreground">
        <Spinner className="size-3" />
        Loading sample…
      </div>
    );
  }
  if (error) {
    return <p className="text-2xs text-destructive">Failed to load sample.</p>;
  }
  if (emptyText) {
    return <p className="text-2xs text-muted-foreground">{emptyText}</p>;
  }
  return <>{children}</>;
}

/**
 * A slim "n of N" stepper pinned atop the Target card when the selected source
 * matched more than one target — so the author can see every match, not just the
 * first. (Source selection lives in SampleObjectControls; the target is the join
 * result, so it only needs to page through the matches.)
 */
export function MatchStepper({
  label,
  position,
  total,
  onPrev,
  onNext,
}: {
  label: string;
  position: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-1">
      <span className="min-w-0 truncate text-2xs font-medium text-muted-foreground">
        {label}
      </span>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Previous match"
          title="Previous match"
          className="size-6 text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
          disabled={position <= 1}
          onClick={onPrev}
        >
          <ChevronLeft />
        </Button>
        <span className="text-2xs text-muted-foreground tabular-nums">
          {position}/{total}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Next match"
          title="Next match"
          className="size-6 text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
          disabled={position >= total}
          onClick={onNext}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

/**
 * A single card in a step's preview chain: a full-height card whose body
 * scrolls vertically. Rows lay several of these side by side. The column's
 * label lives in the stage header row, not on the card. An optional `header`
 * (e.g. the sample-object controls) is pinned above the scroll area.
 */
export function ChainCard({
  header,
  children,
}: {
  header?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card variant="flat" className="flex h-full min-w-0 flex-col">
      {header && (
        <div className="shrink-0 border-b border-border/60 px-2 py-1">
          {header}
        </div>
      )}
      {/* nowheel: keep scroll from zooming the react-flow canvas behind the drawer. */}
      <div className="nowheel min-h-0 flex-1 scrollbar-thin overflow-y-auto p-3">
        {children}
      </div>
    </Card>
  );
}
