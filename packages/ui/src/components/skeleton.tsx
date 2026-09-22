import * as React from 'react';
import { cn } from '../lib/utils';

/**
 * Pulsing placeholder block for first-load states of content with a known
 * shape — size it via `className` to mirror the final layout and avoid
 * shift. Don't hand-roll page skeletons from this: app pages compose the
 * shared loading views (OverviewTableLoadingView, FormLoadingView,
 * CardListLoadingView, TableBodySkeleton) per the loading-states rules.
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'motion-skeleton rounded-md bg-primary/10 opacity-0',
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
