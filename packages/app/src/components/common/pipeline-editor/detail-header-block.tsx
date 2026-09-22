import React from 'react';
import { Button } from '@roadiehq/ui/button';
import { CardHeader } from '@roadiehq/ui/card';
import { ChevronRight } from 'lucide-react';
import { IntegrationIconFrame } from '@roadiehq/ui/item-list';
import { cn } from '@roadiehq/ui/utils';
import {
  getVariantColors,
  getStatusColors,
  type StepVariant,
  type StepStatus,
} from '@roadiehq/ui/step-flow';

export interface StepInfo {
  id: string;
  name: string;
  variant: StepVariant;
  icon: React.ReactNode;
  status: StepStatus;
}

interface DetailHeaderBlockProps {
  steps?: StepInfo[];
  selectedSteps?: string[];
  onStepClick?: (stepId: string, shiftKey: boolean) => void;
}

/**
 * The step breadcrumb at the top of a pipeline editor's details panel: a
 * horizontal row of framed step chips, chevron-separated, with the selected
 * step(s) highlighted in their variant/status colour. Shared by the data-source
 * editor (Schedule ▸ Source ▸ Map ▸ Store) and the actions editor (its steps).
 */
export function DetailHeaderBlock({
  steps,
  selectedSteps = [],
  onStepClick,
}: DetailHeaderBlockProps) {
  if (!steps || steps.length === 0) {
    return null;
  }

  const selectedSet = new Set(selectedSteps);

  function getColorsForStep(step: StepInfo) {
    if (step.status === 'error') {
      return getStatusColors('error');
    }
    if (step.status === 'success') {
      return getStatusColors('success');
    }
    if (step.status === 'running' || step.status === 'configured') {
      return getVariantColors(step.variant);
    }
    return getStatusColors('idle');
  }

  return (
    <CardHeader className="space-y-0 px-3 pt-3 pb-2">
      <div className="flex scrollbar-none items-center gap-1 overflow-x-auto">
        {steps.map((step, index) => {
          const isSelected = selectedSet.has(step.id);
          const colors = getColorsForStep(step);

          return (
            <React.Fragment key={step.id}>
              {index > 0 && (
                <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
              )}
              <Button
                variant="ghost"
                aria-label={`Step ${index + 1}: ${step.name}`}
                aria-current={isSelected ? 'true' : undefined}
                onClick={e => onStepClick?.(step.id, e.shiftKey)}
                onMouseDown={e => {
                  if (e.shiftKey) e.preventDefault();
                }}
                className={cn(
                  'motion-colors flex h-auto items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium select-none',
                  'hover:bg-accent',
                  isSelected
                    ? 'border-2 text-foreground'
                    : 'border border-transparent text-muted-foreground',
                )}
                style={
                  isSelected
                    ? {
                        borderColor: colors.primary,
                        backgroundColor: colors.bg,
                      }
                    : undefined
                }
              >
                <IntegrationIconFrame size="mini">
                  {step.icon}
                </IntegrationIconFrame>
                {step.name}
              </Button>
            </React.Fragment>
          );
        })}
      </div>
    </CardHeader>
  );
}
