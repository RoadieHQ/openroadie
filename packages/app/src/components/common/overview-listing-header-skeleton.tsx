import { Skeleton } from '@roadiehq/ui/skeleton';

/** Mirrors {@link OverviewListingSearchField} `pageHeader` dimensions (toolbar slot only). */
function OverviewListingSearchFieldSkeleton() {
  return (
    <div className="relative h-8 w-full max-w-md min-w-[9rem] sm:w-56 md:w-64 md:min-w-[12rem]">
      <Skeleton className="h-full w-full rounded-md" />
    </div>
  );
}

/**
 * Full listing header chrome for lazy-route Suspense. Mirrors the exact box
 * model of {@link OverviewListingPageHeader} — the same `text-lg` title line and
 * `mt-1 text-sm` description line wrap the skeleton bars, so the header reserves
 * the identical height and the table below it does not shift when the real
 * header replaces the skeleton.
 */
export function OverviewListingPageHeaderSkeleton() {
  return (
    <div
      className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-6 sm:gap-y-4"
      aria-hidden="true"
    >
      <div className="shrink-0">
        <h2 className="text-lg font-semibold">
          <Skeleton className="inline-block h-[1em] w-52 max-w-full rounded-md align-middle sm:w-56" />
        </h2>
        <div className="mt-1 text-sm">
          <Skeleton className="inline-block h-[1em] w-64 max-w-full rounded-md align-middle" />
        </div>
      </div>
      <div className="flex w-full min-w-[min(100%,max-content)] flex-1 flex-wrap items-center justify-end gap-2 md:gap-3">
        <OverviewListingSearchFieldSkeleton />
        <Skeleton className="h-8 w-[4.75rem] shrink-0 rounded-md sm:w-24" />
      </div>
    </div>
  );
}
