import { Skeleton } from '@roadiehq/ui/skeleton';
import { cn } from '@roadiehq/ui/utils';

export interface CardListLoadingViewProps {
  /** Number of placeholder cards. */
  count?: number;
  /** Override the placeholder card sizing (defaults to a card-sized block). */
  cardClassName?: string;
}

/**
 * Loading skeleton for the **card-list / grid** archetype: N stacked card
 * placeholders. Render it inside the page's real `Card`/`CardContent` so the
 * header chrome stays put. See `.claude/rules/loading-states.md`.
 */
export function CardListLoadingView({
  count = 3,
  cardClassName,
}: CardListLoadingViewProps) {
  return (
    <div className="space-y-4" role="status" aria-busy aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton
          key={`card-sk-${i}`}
          className={cn('h-32 w-full rounded-lg', cardClassName)}
        />
      ))}
    </div>
  );
}
