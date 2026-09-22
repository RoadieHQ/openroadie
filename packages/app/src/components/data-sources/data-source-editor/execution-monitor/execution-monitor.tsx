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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@roadiehq/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@roadiehq/ui/tabs';
import { RefreshCw } from 'lucide-react';
import {
  ExecutionLog,
  WorkflowExecution,
  WorkflowRequestLog,
  NodeExecutionState,
} from '../../../../api/workflow/workflow-client';
import { LogsPanel } from './logs-panel';
import { ExecutionFailureNotice } from './execution-failure-notice';
import { ExecutionOverviewTable } from './execution-overview-table';
import { RunsTable } from './runs-table';
import { TrafficTable } from './traffic-table';
import { topologicalSort } from './utils';

type InspectorTab = 'runs' | 'overview' | 'logs' | 'traffic';

export interface ExecutionMonitorProps {
  execution: WorkflowExecution | undefined;
  nodeExecutions: Map<string, NodeExecutionState>;
  logs: ExecutionLog[];
  requestLogs: WorkflowRequestLog[];
  loading: boolean;
  error?: Error;
  isFailed: boolean;
  retry: () => void;
  executions?: WorkflowExecution[];
  executionsLoading?: boolean;
  selectedExecutionId?: string;
  onSelectExecution?: (executionId: string) => void;
  onRetry?: () => void;
  retrying?: boolean;
  onEdit?: () => void;
}

export function ExecutionMonitor({
  execution,
  nodeExecutions,
  logs,
  requestLogs,
  loading,
  error,
  isFailed,
  retry,
  executions = [],
  executionsLoading,
  selectedExecutionId,
  onSelectExecution,
  onRetry,
  retrying,
  onEdit,
}: ExecutionMonitorProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>('overview');

  useEffect(() => {
    if (activeTab === 'runs' && executions.length === 0) {
      setActiveTab('overview');
    }
  }, [activeTab, executions.length]);

  const snapshotNodes = execution?.workflowSnapshot?.nodes;
  const snapshotEdges = execution?.workflowSnapshot?.edges;

  const sortedNodes = useMemo(() => {
    if (!snapshotNodes) {
      return [];
    }
    return topologicalSort(snapshotNodes, snapshotEdges ?? []);
  }, [snapshotNodes, snapshotEdges]);

  const hasNodeError = useMemo(
    () => Array.from(nodeExecutions.values()).some(node => Boolean(node.error)),
    [nodeExecutions],
  );

  const handleSelectAndSwitch = useCallback(
    (id: string) => {
      onSelectExecution?.(id);
      setActiveTab('overview');
    },
    [onSelectExecution],
  );

  if (loading) {
    return (
      <div className="rounded-lg border border-border p-4">
        <div className="h-1 rounded bg-primary/20">
          <div className="motion-safe-pulse size-full rounded bg-primary" />
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Loading execution details…
        </p>
      </div>
    );
  }

  if (error || !execution) {
    return (
      <div className="rounded-lg border border-border p-4">
        <p className="mb-2 text-sm text-destructive">
          {error?.message || 'Execution not found'}
        </p>
        <Button onClick={retry} variant="outline" size="sm">
          <RefreshCw className="mr-1.5 size-3.5" />
          Retry
        </Button>
      </div>
    );
  }

  const triggerClassName =
    'h-9 rounded-none border-b-2 border-transparent px-2 text-sm font-semibold text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none';

  return (
    <Tabs
      value={activeTab}
      onValueChange={value => setActiveTab(value as InspectorTab)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <TabsList className="h-9 w-full shrink-0 justify-start rounded-none border-b border-border bg-transparent p-0 px-3">
        {executions.length > 0 && (
          <TabsTrigger value="runs" className={triggerClassName}>
            Runs ({executions.length})
          </TabsTrigger>
        )}
        <TabsTrigger value="overview" className={triggerClassName}>
          Overview
        </TabsTrigger>
        <TabsTrigger value="logs" className={triggerClassName}>
          Logs ({logs.length})
        </TabsTrigger>
        <TabsTrigger value="traffic" className={triggerClassName}>
          Traffic ({requestLogs.length})
        </TabsTrigger>
      </TabsList>

      <TabsContent
        value="runs"
        className="mt-0 min-h-0 flex-1 scrollbar-thin overflow-auto px-3 pt-3"
      >
        <RunsTable
          executions={executions}
          selectedExecutionId={selectedExecutionId}
          onSelectExecution={handleSelectAndSwitch}
          loading={executionsLoading}
        />
      </TabsContent>

      <TabsContent
        value="overview"
        className="mt-0 min-h-0 flex-1 scrollbar-thin overflow-auto px-3 pt-3"
      >
        <ExecutionOverviewTable
          nodes={sortedNodes}
          nodeExecutions={nodeExecutions}
          onRetry={onRetry}
          retrying={retrying}
          onEdit={onEdit}
        />

        {isFailed && (
          <ExecutionFailureNotice
            error={execution.error}
            hasNodeError={hasNodeError}
          />
        )}
      </TabsContent>

      <TabsContent
        value="logs"
        className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden px-3 pt-3"
      >
        <LogsPanel logs={logs} className="min-h-0 flex-1" />
      </TabsContent>

      <TabsContent
        value="traffic"
        className="mt-0 min-h-0 flex-1 scrollbar-thin overflow-auto px-3 pt-3"
      >
        <TrafficTable logs={requestLogs} />
      </TabsContent>
    </Tabs>
  );
}
