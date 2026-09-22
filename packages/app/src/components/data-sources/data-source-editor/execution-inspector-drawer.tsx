/*
 * Copyright 2025 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useCallback, useId, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@roadiehq/ui/button';
import { Spinner } from '@roadiehq/ui/spinner';
import { cn } from '@roadiehq/ui/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';
import {
  DrawerPanelHeader,
  DrawerResizeHandle,
  useResizableDrawerPanel,
} from '@roadiehq/ui/resizable-drawer';
import { Play, RefreshCw, Square, X } from 'lucide-react';
import type { WorkflowExecution } from '../../../api/workflow/workflow-client';
import { ExecutionSubscription, useExecution } from '../use-execution';
import { ExecutionMonitor } from './execution-monitor';
import {
  computeExecutionStats,
  formatDuration,
} from './execution-monitor/utils';
import { StatusIcon } from '../../common/execution-status';

export interface ExecutionInspectorDrawerProps {
  open: boolean;
  container: HTMLElement | null;
  executionId: string;
  dryRunInProgress?: boolean;
  executions?: WorkflowExecution[];
  executionsLoading?: boolean;
  selectedExecutionId?: string;
  onSelectExecution?: (executionId: string) => void;
  onRefreshExecutions?: () => void;
  onRun?: () => void | Promise<void>;
  onRetry?: () => void;
  /** A manual run/retry is being scheduled; disable Run/Retry and show a spinner. */
  runPending?: boolean;
  onEdit?: () => void;
  onClose: () => void;
}

export function ExecutionInspectorDrawer({
  open,
  container,
  executionId,
  dryRunInProgress,
  executions,
  executionsLoading,
  selectedExecutionId,
  onSelectExecution,
  onRefreshExecutions,
  onRun,
  onRetry,
  runPending,
  onEdit,
  onClose,
}: ExecutionInspectorDrawerProps) {
  const titleId = useId();
  const descriptionId = useId();

  const {
    execution,
    nodeExecutions,
    logs,
    requestLogs,
    status,
    progress,
    loading,
    error,
    isRunning,
    isFailed,
    cancel,
    cancelling,
    retry,
  } = useExecution(executionId);

  const stats = useMemo(
    () => computeExecutionStats(execution, nodeExecutions),
    [execution, nodeExecutions],
  );

  const { panelHeight, isCollapsed, cyclePanelHeight, resizeHandleProps } =
    useResizableDrawerPanel({ open, container, initialHeight: 'mid' });

  const handleRefresh = useCallback(() => {
    retry();
    onRefreshExecutions?.();
  }, [retry, onRefreshExecutions]);

  if (!open || !container) {
    return null;
  }

  const expanded = !isCollapsed;
  const title = (
    <span className="flex items-center gap-2">
      <span className="truncate">
        {execution?.workflowSnapshot?.name || 'Execution'}
      </span>
      <StatusIcon status={status} />
    </span>
  );
  const countLabel = `${progress.completed}/${progress.total} nodes · ${stats.totalItems.toLocaleString()} items · ${formatDuration(stats.totalTime)}`;

  const panel = (
    <TooltipProvider delayDuration={300}>
      <ExecutionSubscription executionId={executionId} />
      <div
        className={cn(
          'flex min-h-0 flex-col bg-background',
          'absolute right-2 bottom-0 left-2 z-overlay rounded-t-lg border border-border shadow-lg lg:right-[50px] lg:left-[50px]',
        )}
        style={{ height: panelHeight }}
        role="region"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <DrawerResizeHandle
          isCollapsed={isCollapsed}
          label="run history"
          props={resizeHandleProps}
        />

        <div className="flex min-h-0 flex-1 flex-col">
          <p id={descriptionId} className="sr-only">
            Workflow run history. The editor remains available while this panel
            is open.
          </p>
          <DrawerPanelHeader
            title={title}
            titleId={titleId}
            countLabel={countLabel}
            expanded={expanded}
            onToggleExpanded={cyclePanelHeight}
            toggleDisabled={false}
            collapsedTitle="Expand run history"
            expandedTitle="Collapse run history"
            standaloneTitle="Open run history"
            actions={
              <>
                {isRunning && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-warning hover:text-warning"
                        onClick={cancel}
                        disabled={cancelling}
                        aria-label={
                          cancelling ? 'Cancelling…' : 'Cancel execution'
                        }
                      >
                        <Square className="size-3.5" aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {cancelling ? 'Cancelling…' : 'Cancel execution'}
                    </TooltipContent>
                  </Tooltip>
                )}
                {!isRunning && onRun && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-success hover:text-success"
                        onClick={onRun}
                        loading={runPending}
                        aria-label="Run workflow"
                      >
                        <Play className="size-3.5" aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Run workflow</TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={handleRefresh}
                      aria-label="Refresh execution"
                    >
                      <RefreshCw className="size-3.5" aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Refresh execution</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={onClose}
                      data-testid="close-inspector"
                      aria-label="Close run history"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Close</TooltipContent>
                </Tooltip>
              </>
            }
          />

          {dryRunInProgress && (
            <div className="h-[3px] w-full bg-border">
              <div className="motion-safe-pulse h-full w-full bg-primary" />
            </div>
          )}
          {isRunning && !dryRunInProgress && (
            <div className="h-[3px] w-full bg-border">
              <div
                className="motion-layout-width-bare h-full bg-primary"
                style={{ width: `${progress.percentage}%` }}
              />
            </div>
          )}

          {expanded && dryRunInProgress && (
            <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
              <Spinner size={14} />
              Dry run in progress…
            </div>
          )}
          {expanded && !dryRunInProgress && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <ExecutionMonitor
                execution={execution}
                nodeExecutions={nodeExecutions}
                logs={logs}
                requestLogs={requestLogs}
                loading={loading}
                error={error}
                isFailed={isFailed}
                retry={retry}
                executions={executions}
                executionsLoading={executionsLoading}
                selectedExecutionId={selectedExecutionId}
                onSelectExecution={onSelectExecution}
                onRetry={onRetry}
                retrying={runPending}
                onEdit={onEdit}
              />
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );

  return createPortal(panel, container);
}
