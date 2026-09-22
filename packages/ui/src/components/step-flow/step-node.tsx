import React from 'react';
import { Trash2, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../button';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '../tooltip';
import { IntegrationIconFrame } from '../item-list/integration-icon-frame';
import { getStatusColors, getVariantColors } from './step-flow-styles';

export type { StepVariant } from './step-flow-styles';

export type StepStatus =
  | 'pending'
  | 'configured'
  | 'running'
  | 'success'
  | 'error'
  | 'warning';

export interface StepNodeProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  status: StepStatus;
  variant: 'trigger' | 'source' | 'transform' | 'sink' | 'output';
  expanded: boolean;
  selected?: boolean;
  /** Header click/keyboard toggle; `shiftKey` is passed through so callers can support multi-select. */
  onToggle: (options?: { shiftKey?: boolean }) => void;
  /** When set, a delete button appears in the header. */
  onDelete?: () => void;
  /** Accessible name for the delete button; defaults to "Delete step". */
  deleteLabel?: string;
  /**
   * Extra controls for the header's right edge, rendered before the delete
   * button and chevron (e.g. an editor's reorder arrows). Handlers should
   * `stopPropagation` so a click doesn't also toggle the node.
   */
  headerActions?: React.ReactNode;
  disabled?: boolean;
  /** Shown as a tooltip over the whole node while `disabled`. */
  disabledReason?: string;
  children?: React.ReactNode;
  testId?: string;
}

/**
 * Collapsible card node in a vertical step flow (pipeline/workflow editors);
 * place a FlowConnector between consecutive nodes. `status` drives the color
 * treatment — `running` animates a sweeping border — while `variant` colors
 * the configured/running states by step kind. Clicking the header calls
 * `onToggle`; the expanded body renders `children`. The node declares
 * `--field-bg`, so outlined fields can sit anywhere inside it.
 */
export function StepNode({
  icon,
  title,
  subtitle,
  status,
  variant,
  expanded,
  selected,
  onToggle,
  onDelete,
  deleteLabel = 'Delete step',
  headerActions,
  disabled,
  disabledReason,
  children,
  testId,
}: StepNodeProps) {
  function getColors() {
    if (status === 'error') {
      return getStatusColors('error');
    }
    if (status === 'success') {
      return getStatusColors('success');
    }
    if (status === 'running' || status === 'configured') {
      return getVariantColors(variant);
    }
    return getStatusColors('idle');
  }
  const colors = getColors();
  const isRunning = status === 'running';

  const outerBorderColor =
    status === 'error'
      ? 'var(--color-destructive)'
      : status === 'warning'
        ? 'var(--color-warning)'
        : status === 'success'
          ? 'var(--color-success)'
          : null;

  const content = (
    <div data-testid={testId} className="relative" aria-busy={isRunning}>
      {isRunning && (
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-px overflow-hidden rounded-[10px]"
        >
          <div
            className="motion-step-border absolute inset-[-50%]"
            style={{
              background: `conic-gradient(
                from 0deg,
                transparent 0deg 270deg,
                ${colors.primarySoft} 320deg,
                ${colors.primary} 355deg,
                transparent 360deg
              )`,
            }}
          />
        </div>
      )}

      <div
        className={cn(
          'motion-border-opacity relative overflow-hidden rounded-lg border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)] [--field-bg:var(--color-card)]',
          (expanded || selected) && 'border-2',
          disabled && 'opacity-50',
        )}
        style={{
          borderColor: isRunning
            ? undefined
            : selected
              ? colors.primary
              : (outerBorderColor ?? 'var(--color-border)'),
        }}
      >
        <div
          className="flex cursor-pointer items-center gap-3 p-4 select-none"
          onClick={e => {
            if (e.shiftKey) {
              e.preventDefault();
            }
            onToggle({ shiftKey: e.shiftKey });
          }}
          onMouseDown={e => {
            if (e.shiftKey) {
              e.preventDefault();
            }
          }}
        >
          {/* Only the icon and text: a role="button" may not contain focusable
              elements. The row above still toggles on click, which is why the
              action buttons stopPropagation. */}
          <div
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-expanded={expanded}
            aria-disabled={disabled || undefined}
            className="flex min-w-0 flex-1 items-center gap-3"
            onKeyDown={e => {
              if (disabled) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onToggle({ shiftKey: e.shiftKey });
              }
            }}
          >
            <IntegrationIconFrame size="row">{icon}</IntegrationIconFrame>

            <div className="min-w-0 flex-1">
              <h3 className="text-base leading-tight font-semibold text-foreground">
                {title}
              </h3>
              {subtitle && (
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {subtitle}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {headerActions}
            {onDelete && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={deleteLabel}
                onClick={e => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="size-icon" />
              </Button>
            )}
            <ChevronDown
              className={cn(
                'motion-transform-standard size-5 text-muted-foreground',
                expanded && 'rotate-180',
              )}
            />
          </div>
        </div>

        <div
          className={cn(
            'motion-grid-rows-standard grid',
            expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
            disabled && 'pointer-events-none',
          )}
        >
          <div className="overflow-hidden">
            <div className="border-t border-border px-6 py-5">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );

  if (disabled && disabledReason) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>{content}</span>
          </TooltipTrigger>
          <TooltipContent side="top">{disabledReason}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return content;
}
