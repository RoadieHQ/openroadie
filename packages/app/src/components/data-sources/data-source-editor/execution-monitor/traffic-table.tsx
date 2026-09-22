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
import { WorkflowRequestLog } from '../../../../api/workflow/workflow-client';
import {
  formatRelativeTime,
  getMethodColor,
  isHttpStatusCodeString,
} from './utils';
import { CopyButton } from '@roadiehq/ui/copy-button';
import {
  INNER_TABLE_WRAPPER,
  INNER_TABLE_HEAD_CELL,
  INNER_TABLE_BODY_CELL,
  InnerTableEmptyState,
} from '../../../common/execution-status';

function formatPath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

const AWS_ACCOUNT_TAG = /\[account:(\d{12})\]/;

function getAwsAccountFromSource(
  source: string | undefined,
): string | undefined {
  if (!source) {
    return undefined;
  }
  const match = source.match(AWS_ACCOUNT_TAG);
  return match?.[1];
}

function getAwsAccountFromTarget(
  target: string | undefined,
): string | undefined {
  if (!target) {
    return undefined;
  }
  const match = target.match(AWS_ACCOUNT_TAG);
  return match?.[1];
}

function getAwsAccountFromLog(log: WorkflowRequestLog): string | undefined {
  return (
    getAwsAccountFromSource(log.source) ?? getAwsAccountFromTarget(log.target)
  );
}

function getDurationColor(ms: number | undefined): string {
  if (ms === undefined) {
    return 'text-muted-foreground';
  }
  if (ms > 2000) {
    return 'text-destructive';
  }
  if (ms > 500) {
    return 'text-warning';
  }
  return 'text-muted-foreground';
}

function getStatusTextColor(status?: string): string {
  if (!status) {
    return 'text-muted-foreground';
  }
  const code = Number(status);
  if (code >= 200 && code < 300) {
    return 'text-success';
  }
  if (code >= 400 && code < 500) {
    return 'text-warning';
  }
  if (code >= 500) {
    return 'text-destructive';
  }
  return 'text-muted-foreground';
}

function StatusCell({ log }: { log: WorkflowRequestLog }) {
  const { status } = log;
  if (status && isHttpStatusCodeString(status)) {
    return (
      <span
        className={`font-mono text-sm font-semibold ${getStatusTextColor(
          status,
        )}`}
      >
        {status}
      </span>
    );
  }
  if (log.error) {
    return (
      <span className="text-sm text-destructive" title={log.error}>
        Error
      </span>
    );
  }
  if (status) {
    return (
      <span className="text-sm text-muted-foreground" title={status}>
        —
      </span>
    );
  }
  return <span className="text-sm text-muted-foreground">—</span>;
}

function MethodChip({ method }: { method: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-1.5 py-0.5 font-mono text-xs font-bold text-white"
      style={{ backgroundColor: getMethodColor(method) }}
    >
      {method}
    </span>
  );
}

function CompactTrafficList({ logs }: { logs: WorkflowRequestLog[] }) {
  return (
    <div className="flex flex-col">
      {logs.map(log => (
        <div
          key={log.id}
          className="border-b border-border px-3 py-2.5 hover:bg-accent/40"
        >
          <div className="mb-1.5 flex items-center gap-2">
            <MethodChip method={log.operation} />
            <span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">
              {formatPath(log.target)}
            </span>
            {getAwsAccountFromLog(log) ? (
              <span className="shrink-0 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                acct:{getAwsAccountFromLog(log)}
              </span>
            ) : null}
            <CopyButton value={log.target} label="Copy URL" />
          </div>
          <div className="flex items-center gap-2 pl-0.5">
            <StatusCell log={log} />
            <span
              className={`font-mono text-xs ${getDurationColor(log.duration)}`}
            >
              {log.duration !== undefined ? `${log.duration}ms` : '-'}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>{formatRelativeTime(log.timestamp)}</span>
                </TooltipTrigger>
                <TooltipContent>
                  {new Date(log.timestamp).toLocaleString()}
                </TooltipContent>
              </Tooltip>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export interface TrafficTableProps {
  logs: WorkflowRequestLog[];
  compact?: boolean;
}

export function TrafficTable({ logs, compact }: TrafficTableProps) {
  if (logs.length === 0) {
    return (
      <InnerTableEmptyState>
        No HTTP requests yet. Execute a workflow to see traffic.
      </InnerTableEmptyState>
    );
  }

  if (compact) {
    return (
      <TooltipProvider delayDuration={300}>
        <CompactTrafficList logs={logs} />
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className={INNER_TABLE_WRAPPER}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={INNER_TABLE_HEAD_CELL}>Time</TableHead>
              <TableHead className={INNER_TABLE_HEAD_CELL}>Method</TableHead>
              <TableHead className={INNER_TABLE_HEAD_CELL}>Path</TableHead>
              <TableHead className={INNER_TABLE_HEAD_CELL}>Status</TableHead>
              <TableHead className={cn(INNER_TABLE_HEAD_CELL, 'text-right')}>
                Duration
              </TableHead>
              <TableHead className="w-9 px-1 py-1.5" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map(log => (
              <TableRow key={log.id}>
                <TableCell
                  className={cn(
                    INNER_TABLE_BODY_CELL,
                    'font-mono whitespace-nowrap',
                  )}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>{formatRelativeTime(log.timestamp)}</span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {new Date(log.timestamp).toLocaleString()}
                    </TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell className={INNER_TABLE_BODY_CELL}>
                  <MethodChip method={log.operation} />
                </TableCell>
                <TableCell
                  className={cn(
                    INNER_TABLE_BODY_CELL,
                    'max-w-[350px] font-mono',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="block min-w-0 flex-1 truncate">
                      {formatPath(log.target)}
                    </span>
                    {getAwsAccountFromLog(log) ? (
                      <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                        acct:{getAwsAccountFromLog(log)}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className={INNER_TABLE_BODY_CELL}>
                  <StatusCell log={log} />
                </TableCell>
                <TableCell
                  className={cn(
                    INNER_TABLE_BODY_CELL,
                    'text-right font-mono',
                    getDurationColor(log.duration),
                  )}
                >
                  {log.duration !== undefined ? `${log.duration}ms` : '-'}
                </TableCell>
                <TableCell className="w-9 px-1 py-1">
                  <CopyButton value={log.target} label="Copy URL" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  );
}
