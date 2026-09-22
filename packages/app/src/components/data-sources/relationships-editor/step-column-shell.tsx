import type { ReactNode } from 'react';
import { Settings } from 'lucide-react';
import { cn } from '@roadiehq/ui/utils';
import { Button } from '@roadiehq/ui/button';
import { Card } from '@roadiehq/ui/card';

export type StepPillTone = 'warning' | 'error' | 'success';

/**
 * A step column's header status pill — guides the user to complete the stage
 * (warning), flags a failure (error), or confirms success. Shared by the rule
 * editor's columns and the manual editor's panels.
 */
export function StepColumnPill({
  label,
  tone,
}: {
  label: string;
  tone: StepPillTone;
}) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium',
        tone === 'error'
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : tone === 'success'
            ? 'border-success/30 bg-success/10 text-success'
            : 'border-warning/30 bg-warning/10 text-warning',
      )}
    >
      {label}
    </span>
  );
}

/**
 * The cogwheel that flips a step column between its preview and its
 * configuration, with an optional status dot. Shared so every stage's toggle
 * looks and behaves identically.
 */
export function StepCogButton({
  active,
  activeLabel,
  inactiveLabel,
  dot,
  onClick,
}: {
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
  dot?: { className: string; label: string } | null;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-pressed={active}
      aria-label={active ? activeLabel : inactiveLabel}
      title={active ? activeLabel : inactiveLabel}
      className={cn(
        'relative size-6 shrink-0 [&_svg]:size-3.5',
        active
          ? 'text-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
      onClick={onClick}
    >
      <Settings />
      {dot && (
        <span
          className={cn(
            'absolute top-0.5 right-0.5 size-1.5 rounded-full ring-1 ring-card',
            dot.className,
          )}
          aria-label={dot.label}
        />
      )}
    </Button>
  );
}

/**
 * The frame for one column in the stepped editor: an uppercase label with an
 * optional status pill and header actions, and a body that shows a preview or —
 * when a panel is open — its configuration on a card. Pure chrome; the rule
 * editor's `StepColumn`/`MatchColumn` and the manual editor's panels all render
 * through it so the columns stay visually identical.
 */
export function StepColumnShell({
  label,
  panelOpen,
  pill,
  actions,
  panel,
  preview,
  className,
}: {
  /** The header label — already includes any "— Configuration"/"— Filter" suffix. */
  label: string;
  panelOpen: boolean;
  pill?: { label: string; tone: StepPillTone } | null;
  actions?: ReactNode;
  panel?: ReactNode;
  preview: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {/* Fixed header height (matches the cogwheel button) so columns with and
          without header actions keep their card tops aligned. */}
      <div className="flex min-h-6 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-2xs font-medium tracking-wide text-muted-foreground uppercase">
            {label}
          </span>
          {pill && <StepColumnPill label={pill.label} tone={pill.tone} />}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {panelOpen ? (
          // nowheel: keep scroll from zooming the react-flow canvas behind the
          // drawer.
          <Card
            variant="flat"
            className="nowheel h-full scrollbar-thin overflow-y-auto py-4 pr-4 pl-2"
          >
            {panel}
          </Card>
        ) : (
          preview
        )}
      </div>
    </div>
  );
}
