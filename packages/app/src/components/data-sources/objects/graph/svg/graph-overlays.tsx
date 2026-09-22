import type { ReactNode } from 'react';
import { Spinner } from '@roadiehq/ui/spinner';
import { cn } from '@roadiehq/ui/utils';
import { RefreshingPill } from '../../../../common';

/** Full-canvas centered status (initial spinner, error, empty message). */
export function GraphCanvasStatus({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'destructive';
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div
        className={cn(
          'px-6 text-center text-sm',
          tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function GraphCanvasSpinner() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <Spinner className="size-8" />
    </div>
  );
}

/** The "keep the previous graph, show progress" pill (loading-states #5). */
export function GraphRefreshingPill() {
  return <RefreshingPill />;
}

/** Top-center truncation warning banner, with an optional action control. */
export function GraphTruncatedBanner({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="pointer-events-none absolute top-3 left-1/2 z-float flex -translate-x-1/2 items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning shadow-sm">
      <span>{children}</span>
      {action && <span className="pointer-events-auto shrink-0">{action}</span>}
    </div>
  );
}
