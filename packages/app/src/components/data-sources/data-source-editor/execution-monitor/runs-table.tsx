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

import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@roadiehq/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';
import { cn } from '@roadiehq/ui/utils';
import { WorkflowExecution } from '../../../../api/workflow/workflow-client';
import { formatDuration, formatRelativeTime } from './utils';
import {
  StatusCell,
  INNER_TABLE_WRAPPER,
  INNER_TABLE_HEAD_CELL,
  INNER_TABLE_BODY_CELL,
  InnerTableEmptyState,
} from '../../../common/execution-status';

export interface RunsTableProps {
  executions: WorkflowExecution[];
  selectedExecutionId?: string;
  onSelectExecution?: (id: string) => void;
  loading?: boolean;
}

export function RunsTable({
  executions,
  selectedExecutionId,
  onSelectExecution,
  loading,
}: RunsTableProps) {
  if (loading) {
    return <InnerTableEmptyState>Loading executions…</InnerTableEmptyState>;
  }

  if (executions.length === 0) {
    return <InnerTableEmptyState>No executions yet</InnerTableEmptyState>;
  }

  return (
    <TooltipProvider>
      <div className={INNER_TABLE_WRAPPER}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={INNER_TABLE_HEAD_CELL}>Status</TableHead>
              <TableHead className={INNER_TABLE_HEAD_CELL}>Trigger</TableHead>
              <TableHead className={INNER_TABLE_HEAD_CELL}>Started</TableHead>
              <TableHead className={cn(INNER_TABLE_HEAD_CELL, 'text-right')}>
                Duration
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {executions.map(exec => {
              const isSelected = exec.id === selectedExecutionId;
              return (
                <TableRow
                  key={exec.id}
                  onClick={() => onSelectExecution?.(exec.id)}
                  aria-selected={isSelected}
                  className={cn(
                    'cursor-pointer border-l-[3px] border-l-transparent',
                    isSelected && 'border-l-primary bg-accent',
                  )}
                >
                  <TableCell className={INNER_TABLE_BODY_CELL}>
                    <StatusCell status={exec.status} />
                  </TableCell>
                  <TableCell
                    className={cn(INNER_TABLE_BODY_CELL, 'capitalize')}
                  >
                    {exec.triggerType}
                  </TableCell>
                  <TableCell className={INNER_TABLE_BODY_CELL}>
                    {exec.startedAt ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="font-mono text-sm">
                            {formatRelativeTime(exec.startedAt)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {new Date(exec.startedAt).toLocaleString()}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell
                    className={cn(
                      INNER_TABLE_BODY_CELL,
                      'text-right font-mono',
                    )}
                  >
                    {exec.startedAt
                      ? formatDuration(
                          (exec.completedAt
                            ? new Date(exec.completedAt).getTime()
                            : Date.now()) - new Date(exec.startedAt).getTime(),
                        )
                      : '-'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  );
}
