import React from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@roadiehq/ui/utils';
import { Button } from '@roadiehq/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@roadiehq/ui/dropdown-menu';
import type { FlowConnectorState } from '@roadiehq/ui/step-flow';

export interface InsertStepMenuItem {
  icon: React.ReactNode;
  label: string;
  onSelect: () => void;
}

export interface InsertStepConnectorProps {
  /**
   * Insert options at this position. A single item inserts directly when the
   * button is clicked; two or more open a dropdown menu.
   */
  items: InsertStepMenuItem[];
  state?: FlowConnectorState;
  disabled?: boolean;
  testId?: string;
  /** Accessible name for the insert button. */
  addLabel?: string;
}

/**
 * A flow connector with an inline "+" control that inserts a step at this
 * position. Shared by the data-source editor (Filter / Map / Chained Source
 * menu) and the actions editor (a single HTTP step). Mirrors the FlowConnector
 * line/arrow visuals, with `state`-driven flowing/completed animation.
 */
export function InsertStepConnector({
  items,
  state = 'idle',
  disabled,
  testId,
  addLabel = 'Insert step',
}: InsertStepConnectorProps) {
  const isFlowing = state === 'flowing';
  const isCompleted = state === 'completed';
  const borderColor = 'var(--color-border)';

  const lineBackground = isFlowing
    ? `linear-gradient(180deg,
        transparent 0%,
        var(--color-info) 30%,
        var(--color-info) 50%,
        transparent 80%)`
    : isCompleted
      ? 'linear-gradient(180deg, var(--color-success) 0%, var(--color-success) 100%)'
      : `linear-gradient(180deg, ${borderColor} 0%, color-mix(in srgb, ${borderColor} 70%, transparent) 100%)`;

  const arrowColor = isCompleted
    ? 'var(--color-success)'
    : isFlowing
      ? 'var(--color-info)'
      : borderColor;

  const lineCommonStyle: React.CSSProperties = isFlowing
    ? { background: lineBackground, backgroundSize: '100% 200%' }
    : { background: lineBackground };
  const lineClass = cn(
    'h-3 w-0.5 dark:opacity-60',
    isFlowing && 'motion-step-connector',
  );

  const button = (
    <Button
      variant="ghost"
      size="icon"
      disabled={disabled}
      aria-label={addLabel}
      data-testid={testId}
      className={cn(
        'size-icon-lg rounded-full border border-dashed',
        'border-border hover:border-primary hover:bg-primary/10',
      )}
      {...(items.length === 1 ? { onClick: items[0].onSelect } : {})}
    >
      <Plus className="size-3.5" />
    </Button>
  );

  return (
    <div className="relative flex flex-col items-center py-1">
      <div className={lineClass} style={lineCommonStyle} />

      <div className="flex items-center gap-2">
        {items.length === 1 ? (
          button
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="right">
              {items.map(item => (
                <DropdownMenuItem key={item.label} onSelect={item.onSelect}>
                  {item.icon}
                  <span>{item.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className={lineClass} style={lineCommonStyle} />

      <div
        className="size-0"
        style={{
          borderLeft: '4px solid transparent',
          borderRight: '4px solid transparent',
          borderTop: `6px solid ${arrowColor}`,
          filter: isFlowing
            ? 'drop-shadow(0 0 4px color-mix(in srgb, var(--color-info) 50%, transparent))'
            : isCompleted
              ? 'drop-shadow(0 0 4px color-mix(in srgb, var(--color-success) 50%, transparent))'
              : 'none',
        }}
      />
    </div>
  );
}
