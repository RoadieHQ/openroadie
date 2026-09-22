import * as React from 'react';
import { cn } from '../lib/utils';

/**
 * Semantic tone of a status indicator. Domain code maps its own status
 * vocabulary (execution states, readiness, lifecycle, …) to one of these; the
 * primitive only knows how to colour it.
 */
export type StatusIndicatorTone =
  | 'neutral'
  | 'info'
  | 'success'
  | 'destructive'
  | 'warning';

function toneDotClass(tone: StatusIndicatorTone): string {
  switch (tone) {
    case 'success':
      return 'bg-success';
    case 'destructive':
      return 'bg-destructive';
    case 'warning':
      return 'bg-warning';
    case 'info':
      return 'bg-info';
    case 'neutral':
      return 'bg-muted-foreground';
  }
}

/** A slight same-colour glow, for dot-only cells where the dot is the whole signal. */
function toneGlowClass(tone: StatusIndicatorTone): string {
  switch (tone) {
    case 'success':
      return 'shadow-[0_0_3px_var(--color-success)]';
    case 'destructive':
      return 'shadow-[0_0_3px_var(--color-destructive)]';
    case 'warning':
      return 'shadow-[0_0_3px_var(--color-warning)]';
    case 'info':
      return 'shadow-[0_0_3px_var(--color-info)]';
    case 'neutral':
      return 'shadow-[0_0_3px_var(--color-muted-foreground)]';
  }
}

export interface StatusDotProps {
  tone: StatusIndicatorTone;
  /** Pulse the dot for in-flight states (e.g. a running execution). */
  pulse?: boolean;
  /** Add a subtle same-colour glow (dot-only cells where the dot is the signal). */
  glow?: boolean;
  /** Size/spacing overrides; the default dot is `size-2`. */
  className?: string;
}

/** A tone-coloured status dot. Purely decorative — pair it with a label. */
export function StatusDot({
  tone,
  pulse,
  glow,
  className,
}: StatusDotProps): JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        toneDotClass(tone),
        glow && toneGlowClass(tone),
        pulse && 'motion-pulse',
        className,
      )}
    />
  );
}

export interface StatusCellProps {
  tone: StatusIndicatorTone;
  /** Human status label, e.g. `Completed` / `Needs setup`. */
  label: React.ReactNode;
  /** Pulse the dot for in-flight states. */
  pulse?: boolean;
  className?: string;
}

/** Dot + inline label — the standard status cell for tables and drawers. */
export function StatusCell({
  tone,
  label,
  pulse,
  className,
}: StatusCellProps): JSX.Element {
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <StatusDot tone={tone} pulse={pulse} />
      <span className="text-sm">{label}</span>
    </div>
  );
}
