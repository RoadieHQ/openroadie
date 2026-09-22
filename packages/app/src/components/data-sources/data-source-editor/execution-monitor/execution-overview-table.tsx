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
import { RefreshCw } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@roadiehq/ui/table';
import { cn } from '@roadiehq/ui/utils';
import {
  WorkflowNode,
  NodeExecutionState,
} from '../../../../api/workflow/workflow-client';
import { formatDuration } from './utils';
import { ErrorDisplay } from '../error-display';
import {
  StatusCell,
  INNER_TABLE_WRAPPER,
  INNER_TABLE_HEAD_CELL,
  INNER_TABLE_BODY_CELL,
  InnerTableEmptyState,
} from '../../../common/execution-status';

export interface ExecutionOverviewTableProps {
  nodes: WorkflowNode[];
  nodeExecutions: Map<string, NodeExecutionState>;
  onRetry?: () => void;
  onEdit?: () => void;
  /** A re-run kicked off from Retry is being scheduled — spin and disable it. */
  retrying?: boolean;
}

export function ExecutionOverviewTable({
  nodes,
  nodeExecutions,
  onRetry,
  onEdit,
  retrying = false,
}: ExecutionOverviewTableProps) {
  if (nodes.length === 0) {
    return (
      <InnerTableEmptyState>No nodes in workflow snapshot</InnerTableEmptyState>
    );
  }

  return (
    <div className={INNER_TABLE_WRAPPER}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className={INNER_TABLE_HEAD_CELL}>Status</TableHead>
            <TableHead className={INNER_TABLE_HEAD_CELL}>Node</TableHead>
            <TableHead className={INNER_TABLE_HEAD_CELL}>Type</TableHead>
            <TableHead className={cn(INNER_TABLE_HEAD_CELL, 'text-right')}>
              Items
            </TableHead>
            <TableHead className={cn(INNER_TABLE_HEAD_CELL, 'text-right')}>
              Duration
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {nodes.map(node => {
            const exec = nodeExecutions.get(node.id);
            const nodeStatus = exec?.status ?? 'pending';
            const duration =
              exec?.startedAt && exec?.completedAt
                ? new Date(exec.completedAt).getTime() -
                  new Date(exec.startedAt).getTime()
                : null;
            return (
              <React.Fragment key={node.id}>
                <TableRow>
                  <TableCell className={INNER_TABLE_BODY_CELL}>
                    <StatusCell status={nodeStatus} />
                  </TableCell>
                  <TableCell
                    className={cn(INNER_TABLE_BODY_CELL, 'font-semibold')}
                  >
                    {node.data.label || node.id}
                  </TableCell>
                  <TableCell className={cn(INNER_TABLE_BODY_CELL, 'font-mono')}>
                    {node.type}
                  </TableCell>
                  <TableCell
                    className={cn(
                      INNER_TABLE_BODY_CELL,
                      'text-right font-mono',
                    )}
                  >
                    {exec?.itemCount?.toLocaleString() ?? '-'}
                  </TableCell>
                  <TableCell
                    className={cn(
                      INNER_TABLE_BODY_CELL,
                      'text-right font-mono',
                    )}
                  >
                    {duration !== null ? formatDuration(duration) : '-'}
                  </TableCell>
                </TableRow>
                {exec?.error && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="border-l-[3px] border-l-destructive bg-destructive/[0.06] px-3 py-1.5"
                    >
                      <div className="flex items-start gap-2">
                        {/* Expandable rather than clipped to one line: the
                            actionable part of a sink error (the offending ids,
                            the suggested expression) is past the fold. */}
                        <div className="min-w-0 flex-1">
                          <ErrorDisplay error={exec.error} variant="inline" />
                        </div>
                        {onRetry && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={onRetry}
                            disabled={retrying}
                            className="h-7 shrink-0 gap-1.5 px-2 text-xs"
                          >
                            <RefreshCw
                              className={cn(
                                'size-3.5',
                                retrying && 'motion-icon-spin',
                              )}
                              aria-hidden="true"
                            />
                            {retrying ? 'Retrying…' : 'Retry'}
                          </Button>
                        )}
                        {onEdit && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={onEdit}
                            className="h-7 shrink-0 px-2 text-xs"
                          >
                            Edit
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
