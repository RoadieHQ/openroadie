import React from 'react';
import { cn } from '../../lib/utils';

export type FlowConnectorState = 'idle' | 'flowing' | 'completed';

export interface FlowConnectorProps {
  state?: FlowConnectorState;
  /** @deprecated use `state` instead. `animated` is kept for backwards compatibility. */
  animated?: boolean;
  label?: string;
  dashed?: boolean;
}

/**
 * Vertical connector arrow rendered between StepNodes in a step flow.
 * `state` mirrors the run: `flowing` animates data moving down the line,
 * `completed` turns it solid success-colored; `dashed` marks a
 * tentative/optional link, and `label` renders an inline pill on the line.
 */
export function FlowConnector({
  state,
  animated,
  label,
  dashed = false,
}: FlowConnectorProps) {
  const resolvedState: FlowConnectorState =
    state ?? (animated ? 'flowing' : 'idle');
  const isFlowing = resolvedState === 'flowing';
  const isCompleted = resolvedState === 'completed';

  const borderColor = 'var(--color-border)';

  const flowingBackground = `linear-gradient(
    180deg,
    transparent 0%,
    var(--color-info) 30%,
    var(--color-info) 50%,
    transparent 80%
  )`;
  const completedBackground = `linear-gradient(180deg, var(--color-success) 0%, var(--color-success) 100%)`;
  const idleBackground = `linear-gradient(180deg, ${borderColor} 0%, color-mix(in srgb, ${borderColor} 70%, transparent) 100%)`;

  const lineCommon = { width: 2 } as const;
  const lineStyle: React.CSSProperties = dashed
    ? {
        ...lineCommon,
        background: 'transparent',
        borderLeft: '2px dashed',
        borderColor,
      }
    : isFlowing
      ? {
          ...lineCommon,
          background: flowingBackground,
          backgroundSize: '100% 200%',
        }
      : isCompleted
        ? { ...lineCommon, background: completedBackground }
        : { ...lineCommon, background: idleBackground };

  const lineClassName = !dashed && isFlowing ? 'motion-step-connector' : '';

  const arrowColor = isCompleted
    ? 'var(--color-success)'
    : isFlowing
      ? 'var(--color-info)'
      : borderColor;

  return (
    <div className="flex flex-col items-center py-1">
      <div className={cn('h-4', lineClassName)} style={lineStyle} />

      {label && (
        <div className="my-1 rounded-lg border border-dashed border-border bg-card px-4 py-1 whitespace-nowrap">
          <span className="text-xs tracking-wide text-muted-foreground italic">
            {label}
          </span>
        </div>
      )}

      <div
        className={cn(label ? 'h-4' : 'h-5', lineClassName)}
        style={lineStyle}
      />

      <div
        className="motion-all-panel size-0"
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
