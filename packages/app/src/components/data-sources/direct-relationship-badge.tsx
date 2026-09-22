import { Badge } from '@roadiehq/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';

/**
 * Marks an edge as a direct relationship — the counterpart to
 * {@link RelationshipRuleBadge}, so the two provenances read as a pair
 * wherever rows of both kinds mix. The tooltip carries the explanation for
 * anyone who hasn't met the concept yet.
 */
export function DirectRelationshipBadge({ className }: { className?: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outlineMuted"
            className={className ?? 'shrink-0 px-1.5 text-2xs'}
          >
            Direct relationship
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">
          A direct relationship — created by hand between these two objects, not
          materialized by a relationship rule.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
