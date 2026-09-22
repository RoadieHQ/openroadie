import type { ReactNode } from 'react';
import { cn } from '@roadiehq/ui/utils';
import { truncateLabel } from './graph-edge-geometry';

/** Collapsed context-group nodes use the brand primary — clearly outside the
 * datasource palette, matching the Users-in-primary group iconography. */
export const CONTEXT_GROUP_NODE_COLOR = 'var(--color-primary)';
/** Legend row id for the context-groups entry (not a datasource id). */
export const CONTEXT_GROUP_LEGEND_ID = '__context-groups__';

/**
 * The kit's basic node mark: a datasource-colored circle with a halo'd
 * label below. Mode views compose decorations (rings, badges, counts) as
 * children — those marks are mode vocabulary, not kit vocabulary.
 */
export function GraphNodeShape({
  radius,
  color,
  label,
  showLabel = true,
  hovered = false,
  emphasized = false,
  dashed = false,
  labelClassName,
  children,
}: {
  radius: number;
  color: string;
  label: string;
  showLabel?: boolean;
  hovered?: boolean;
  /** Bolder label treatment (roots, endpoints). */
  emphasized?: boolean;
  dashed?: boolean;
  labelClassName?: string;
  children?: ReactNode;
}) {
  return (
    <>
      <circle
        r={radius}
        fill={color}
        className={cn('stroke-background', hovered && 'stroke-foreground/50')}
        strokeWidth={2}
        strokeDasharray={dashed ? '3 2.5' : undefined}
      />
      {showLabel && (
        <text
          y={radius + 12}
          textAnchor="middle"
          className={cn(
            '[stroke:var(--color-background)] [stroke-width:3px] text-[10.5px] [paint-order:stroke]',
            emphasized
              ? 'fill-foreground font-semibold'
              : 'fill-muted-foreground',
            hovered && 'fill-foreground font-medium',
            labelClassName,
          )}
        >
          {truncateLabel(label)}
        </text>
      )}
      {children}
    </>
  );
}
