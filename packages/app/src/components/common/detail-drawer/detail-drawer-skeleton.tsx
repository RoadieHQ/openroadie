import { Skeleton } from '@roadiehq/ui/skeleton';

/**
 * Body skeleton for {@link DetailDrawer}, mirroring the common layout: a stat
 * row, a block of label/value rows, and a small section. The drawer header
 * stays put (only the body swaps), per the loading-states rule.
 */
export function DetailDrawerSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={`sk-stat-${i}`} className="h-14 rounded-md" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={`sk-row-${i}`}
            className="grid grid-cols-[minmax(0,8rem)_1fr] gap-x-4"
          >
            <Skeleton className="h-4 w-20 rounded" />
            <Skeleton className="h-4 w-full max-w-[14rem] rounded" />
          </div>
        ))}
      </div>
      <Skeleton className="h-32 w-full rounded-md" />
    </div>
  );
}
