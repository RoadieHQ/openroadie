import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { motionTransitions } from '@roadiehq/ui/motion';
import { OverviewListingTableCard } from '../common';

export interface OverviewEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  animated?: boolean;
  action?: ReactNode;
}

/**
 * Shared whole-list-empty state for overview pages. Renders inside the same
 * bordered {@link OverviewListingTableCard} as the populated table and fills the
 * available height, so an empty page occupies the same footprint as a populated
 * one — keeping the five overviews visually consistent. Pages with a ghost
 * preview of their populated self use {@link OverviewEmptyPreview}.
 */
export function OverviewEmptyState({
  icon: Icon,
  title,
  description,
  animated = false,
  action,
}: OverviewEmptyStateProps): JSX.Element {
  const prefersReducedMotion = useReducedMotion();
  const motionEnabled = animated && !prefersReducedMotion;

  return (
    <OverviewListingTableCard>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 py-16 text-center">
        <motion.div
          className="mb-2 flex size-16 items-center justify-center rounded-full bg-primary/10"
          animate={motionEnabled ? { y: [0, -5, 0] } : undefined}
          transition={motionEnabled ? motionTransitions.gentleFloat : undefined}
        >
          <Icon className="size-8 text-primary" />
        </motion.div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {description ? (
          <p className="max-w-md text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </OverviewListingTableCard>
  );
}
