import { Skeleton } from '@roadiehq/ui/skeleton';

export interface FormLoadingViewProps {
  /** Number of labeled field placeholders. */
  fields?: number;
}

/**
 * Loading skeleton for the **form / single-detail** archetype: N labeled field
 * placeholders (label bar + control bar). Render it inside the page's real
 * `Card`/`CardContent` so the header chrome stays put. See
 * `.claude/rules/loading-states.md`.
 */
export function FormLoadingView({ fields = 4 }: FormLoadingViewProps) {
  return (
    <div
      className="space-y-4"
      role="status"
      aria-busy
      aria-label="Loading form"
    >
      {Array.from({ length: fields }, (_, i) => (
        <div key={`form-sk-${i}`} className="space-y-2">
          <Skeleton className="h-4 w-24 rounded-md" />
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
      ))}
    </div>
  );
}
