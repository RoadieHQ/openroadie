import { Badge } from '@roadiehq/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';

/**
 * Marks an edge as created by a relationship rule — the counterpart to
 * {@link DirectRelationshipBadge}, so the two provenances read as a pair
 * wherever rows of both kinds mix.
 */
export function RelationshipRuleBadge({
  ruleName,
  className,
}: {
  /** Names the rule in the tooltip when the caller has it resolved. */
  ruleName?: string;
  className?: string;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outlineMuted"
            className={className ?? 'shrink-0 px-1.5 text-2xs'}
          >
            Relationship rule
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">
          {ruleName
            ? `Created by the relationship rule "${ruleName}" — matching objects are linked automatically.`
            : 'Created by a relationship rule — matching objects are linked automatically.'}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
