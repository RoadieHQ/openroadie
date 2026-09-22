import React from 'react';
import {
  StatusDot,
  type StatusIndicatorTone,
} from '@roadiehq/ui/status-indicator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';
import { cn } from '@roadiehq/ui/utils';

/**
 * Semantic state of a status dot. The colour carries the meaning; the human
 * label lives in the tooltip (and inline only in the `expanded` variant).
 */
export type OverviewStatusTone =
  | 'success'
  | 'muted'
  | 'warning'
  | 'destructive';

/** The overview taxonomy's tones map 1:1 onto the ui primitive's, bar naming. */
function toIndicatorTone(tone: OverviewStatusTone): StatusIndicatorTone {
  return tone === 'muted' ? 'neutral' : tone;
}

export interface OverviewStatusCellProps {
  tone: OverviewStatusTone;
  /** Human status label, e.g. `Ready` / `Needs setup`. */
  label: string;
  /** Tooltip text; defaults to {@link label}. Pass `null` to disable it. */
  tooltip?: string | null;
  /**
   * Show the label inline next to the dot (the "expanded" variant for detail
   * drawers). Overviews leave this off so the column reads as a single dot.
   */
  expanded?: boolean;
  /**
   * Stretch to fill the table cell so the whole cell (not just the dot) is the
   * hover/click target and tooltip trigger. Use when the status cell is the
   * sole content of its column; leave off when it shares a row with siblings.
   */
  fill?: boolean;
  /** When set, the cell becomes a button invoking this (e.g. resolve setup). */
  onClick?: () => void;
  className?: string;
}

/**
 * Shared status indicator for every overview Status column and detail-drawer
 * Status field.
 *
 * The coloured dot is the primary signal; the label is kept for assistive tech
 * (`sr-only`) and shown on hover via a tooltip, so an overview column reads as a
 * single dot — no redundant text beside a green dot. Pass {@link expanded} to
 * also render the label inline (the drawer variant), e.g. "● Needs setup".
 */
export function OverviewStatusCell({
  tone,
  label,
  tooltip,
  expanded,
  fill,
  onClick,
  className,
}: OverviewStatusCellProps): JSX.Element {
  const withLabel = expanded ?? false;
  const tooltipText = tooltip === null ? null : (tooltip ?? label);
  const interactive = !!onClick;

  const dot = (
    <StatusDot tone={toIndicatorTone(tone)} glow className="size-1.5" />
  );

  const body = (
    <span
      className={cn(
        // `min-h-5` matches a text line so the dot centres vertically like the
        // other columns; `fill` stretches the hit area to the whole cell.
        'inline-flex min-h-5 items-center gap-1.5 text-sm text-muted-foreground',
        fill && 'w-full',
        // Dot-only table cells centre in the column (their headers are
        // `align: 'center'` to match). This also puts the tooltip — anchored to
        // this full-width trigger — directly above the dot instead of off to
        // its right. The `expanded` dot+label variant stays left-aligned.
        fill && !withLabel && 'justify-center',
        interactive ? 'cursor-pointer hover:text-foreground' : 'cursor-default',
        className,
      )}
      {...(interactive
        ? {
            role: 'button',
            tabIndex: 0,
            onClick,
            onKeyDown: (event: React.KeyboardEvent) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick?.();
              }
            },
          }
        : {})}
    >
      {dot}
      {withLabel ? (
        <span className="whitespace-nowrap">{label}</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </span>
  );

  if (!tooltipText) return body;

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{body}</TooltipTrigger>
        <TooltipContent>{tooltipText}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
