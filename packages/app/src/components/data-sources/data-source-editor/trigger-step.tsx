import React, { useMemo, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, MoreHorizontal } from 'lucide-react';
import { StepNode, StepStatus } from './step-components';
import { FlowConnector, edgeState } from './step-components';
import { useDataSourceEditorContext } from './data-source-editor-context';
import { ScheduleTriggerConfig } from './triggers/schedule-trigger-config';
import { workspaceQueryKey } from '../../../api/workspace-scope';

export function TriggerStep() {
  const {
    triggerType,
    triggerConfig,
    expandedStep,
    selectedSteps,
    handleStepClick,
    handleTriggerConfigChange,
    workflowId,
    isEnabled,
    workflowApi,
    runningNodes,
    nodeOutputs,
    scheduleRefreshNonce,
  } = useDataSourceEditorContext();

  // `scheduleRefreshNonce` is part of the key so a save triggers an immediate
  // refetch (endorsed nonce-as-key-input pattern).
  const scheduleEnabled =
    !!workflowId && isEnabled && triggerType === 'schedule';
  const scheduleInfoQuery = useQuery({
    queryKey: workspaceQueryKey(
      'workflows',
      'scheduleInfo',
      workflowId ?? '',
      scheduleRefreshNonce,
    ),
    queryFn: () => workflowApi.workflows.getScheduleInfo(workflowId as string),
    enabled: scheduleEnabled,
  });
  const nextRunAt = scheduleEnabled
    ? (scheduleInfoQuery.data?.nextRunAt ?? null)
    : null;

  // After a save the backend's nextRunAt lags; nudge a few refetches so the
  // displayed time catches up without a manual reload.
  const { refetch: refetchScheduleInfo } = scheduleInfoQuery;
  useEffect(() => {
    if (!scheduleEnabled || scheduleRefreshNonce === 0) {
      return undefined;
    }
    const timers = [1500, 4000, 7000].map(delayMs =>
      setTimeout(() => void refetchScheduleInfo(), delayMs),
    );
    return () => timers.forEach(clearTimeout);
  }, [scheduleEnabled, scheduleRefreshNonce, refetchScheduleInfo]);

  const handleConfigChange = useCallback(
    (field: string, value: unknown) => {
      handleTriggerConfigChange(field, value);
    },
    [handleTriggerConfigChange],
  );

  const triggerStatus: StepStatus = useMemo(() => {
    if (!triggerType) {
      return 'pending';
    }
    if (triggerConfig.frequencyValue && triggerConfig.frequencyUnit) {
      return 'configured';
    }
    return 'pending';
  }, [triggerType, triggerConfig]);

  const triggerSubtitle = useMemo(() => {
    if (!triggerType) {
      return 'No trigger configured';
    }
    const val = (triggerConfig.frequencyValue as number) ?? 1;
    const unit = (triggerConfig.frequencyUnit as string) ?? 'hours';
    if (unit === 'weeks') {
      const day = (triggerConfig.dayOfWeek as string) ?? '';
      const prefix = val === 1 ? 'Every week' : `Every ${val} weeks`;
      return day ? `${prefix} on ${day}` : prefix;
    }
    if (val === 1) {
      return `Every ${unit.slice(0, -1)}`;
    }
    return `Every ${val} ${unit}`;
  }, [triggerType, triggerConfig]);

  const triggerIcon = useMemo(() => {
    if (triggerType === 'schedule') {
      return <Clock className="size-5" />;
    }
    return <MoreHorizontal className="size-5" />;
  }, [triggerType]);

  const triggerTitle = useMemo(() => {
    if (triggerType === 'schedule') {
      return 'Schedule';
    }
    return 'Trigger';
  }, [triggerType]);

  if (!triggerType) {
    return <FlowConnector dashed label="Add triggers (optional)" />;
  }

  return (
    <>
      <StepNode
        icon={triggerIcon}
        title={triggerTitle}
        subtitle={triggerSubtitle}
        status={triggerStatus}
        variant="trigger"
        expanded={expandedStep === 'trigger'}
        selected={selectedSteps.includes('trigger')}
        onToggle={opts => handleStepClick('trigger', opts?.shiftKey ?? false)}
        testId="trigger-step"
      >
        {triggerType === 'schedule' ? (
          <ScheduleTriggerConfig
            config={triggerConfig}
            onChange={handleConfigChange}
            nextRunAt={nextRunAt ?? undefined}
          />
        ) : (
          <div className="py-6 text-center">
            <p className="text-sm text-muted-foreground">
              Select a trigger type from the left panel
            </p>
          </div>
        )}
      </StepNode>
      <FlowConnector
        state={edgeState(
          'trigger-node',
          'source-node',
          runningNodes,
          nodeOutputs,
        )}
      />
    </>
  );
}
