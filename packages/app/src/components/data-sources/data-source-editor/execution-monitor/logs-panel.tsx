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

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';
import { Badge } from '@roadiehq/ui/badge';
import { Button } from '@roadiehq/ui/button';
import { Input } from '@roadiehq/ui/input';
import { OutlinedSelect } from '@roadiehq/ui/outlined-select';
import { SelectItem } from '@roadiehq/ui/select';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@roadiehq/ui/table';
import { TooltipProvider } from '@roadiehq/ui/tooltip';
import { cn } from '@roadiehq/ui/utils';
import { ArrowDown, ChevronRight, Search } from 'lucide-react';
import { ExecutionLog } from '../../../../api/workflow/workflow-client';
import { CopyButton } from '@roadiehq/ui/copy-button';
import { INNER_TABLE_HEAD_CELL } from '../../../common/execution-status';

function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
}

function getLevelVariant(
  level: string,
): 'default' | 'warning' | 'destructive' | 'secondary' {
  switch (level) {
    case 'info':
      return 'default';
    case 'warn':
      return 'warning';
    case 'error':
      return 'destructive';
    default:
      return 'secondary';
  }
}

function getLevelRowTint(level: string): string {
  if (level === 'error') {
    return 'bg-destructive/5 hover:bg-destructive/10';
  }
  if (level === 'warn') {
    return 'bg-warning/5 hover:bg-warning/10';
  }
  return 'hover:bg-accent/40';
}

function LevelChip({ level }: { level: string }) {
  return (
    <Badge
      variant={getLevelVariant(level)}
      className="rounded-full px-1.5 py-0.5 text-xs"
    >
      {level.toUpperCase()}
    </Badge>
  );
}

function logKey(log: ExecutionLog): string {
  return String(log.id);
}

function useExpandedKeys(): {
  expandedKeys: Set<string>;
  toggleExpanded: (key: string) => void;
} {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const toggleExpanded = useCallback((key: string) => {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);
  return { expandedKeys, toggleExpanded };
}

function hasTextSelection(): boolean {
  const selection = window.getSelection();
  return Boolean(selection && selection.toString().length > 0);
}

// Heuristic: messages worth offering an expand affordance for. Anything that
// fits comfortably on a single row (short status pings) doesn't need it.
const EXPANDABLE_MESSAGE_LENGTH = 100;
function isExpandableMessage(message: string): boolean {
  return message.length > EXPANDABLE_MESSAGE_LENGTH || message.includes('\n');
}

function ScrollToBottomPill({ unreadCount }: { unreadCount: number }) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  if (isAtBottom) {
    return null;
  }
  const label =
    unreadCount > 0
      ? `${unreadCount} new log${unreadCount === 1 ? '' : 's'}`
      : 'Jump to latest';
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => scrollToBottom()}
      className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 gap-1.5 rounded-full px-3 shadow-md"
    >
      <ArrowDown className="size-3.5" aria-hidden="true" />
      {label}
    </Button>
  );
}

interface LogRowSharedProps {
  log: ExecutionLog;
  expanded: boolean;
  onToggleExpand: () => void;
}

function CompactLogRow({ log, expanded, onToggleExpand }: LogRowSharedProps) {
  const expandable = isExpandableMessage(log.message);
  const handleClick = (event: React.MouseEvent) => {
    if (!expandable) return;
    if (
      event.target instanceof HTMLElement &&
      event.target.closest('[data-stop-row-toggle]')
    ) {
      return;
    }
    if (hasTextSelection()) {
      return;
    }
    onToggleExpand();
  };
  const interactiveProps = expandable
    ? {
        role: 'button' as const,
        tabIndex: 0,
        'aria-expanded': expanded,
        onClick: handleClick,
        onKeyDown: (event: React.KeyboardEvent) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggleExpand();
          }
        },
      }
    : {};
  return (
    <div
      {...interactiveProps}
      className={cn(
        'border-b border-border px-3 py-2.5',
        expandable && 'cursor-pointer',
        getLevelRowTint(log.level),
      )}
    >
      <div className="mb-1 flex items-center gap-2">
        <LevelChip level={log.level} />
        <span className="font-mono text-xs text-muted-foreground">
          {formatTimestamp(log.createdAt)}
        </span>
        {log.nodeId && (
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {log.nodeId}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1" data-stop-row-toggle>
          <CopyButton value={log.message} label="Copy message" />
        </div>
      </div>
      <div
        className={cn(
          'motion-height-standard overflow-hidden',
          expanded ? 'h-auto' : 'h-5',
        )}
      >
        <p
          data-log-message
          className={cn(
            'm-0 pl-0.5 text-sm text-foreground select-text',
            expanded ? 'break-words whitespace-pre-wrap' : 'truncate',
          )}
        >
          {log.message}
        </p>
      </div>
    </div>
  );
}

function CompactLogsList({ logs }: { logs: ExecutionLog[] }) {
  const { expandedKeys, toggleExpanded } = useExpandedKeys();
  return (
    <div className="flex flex-col">
      {logs.map(log => {
        const key = logKey(log);
        return (
          <CompactLogRow
            key={key}
            log={log}
            expanded={expandedKeys.has(key)}
            onToggleExpand={() => toggleExpanded(key)}
          />
        );
      })}
    </div>
  );
}

function TableLogRow({ log, expanded, onToggleExpand }: LogRowSharedProps) {
  const expandable = isExpandableMessage(log.message);
  const handleRowClick = (event: React.MouseEvent<HTMLTableRowElement>) => {
    if (!expandable) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (
      target.closest('[data-stop-row-toggle]') ||
      target.closest('[data-expand-control]')
    ) {
      return;
    }
    if (hasTextSelection()) {
      return;
    }
    onToggleExpand();
  };
  return (
    <TableRow
      aria-expanded={expandable ? expanded : undefined}
      onClick={expandable ? handleRowClick : undefined}
      className={cn(expandable && 'cursor-pointer', getLevelRowTint(log.level))}
    >
      <TableCell className="w-6 px-1 py-1 align-top text-muted-foreground">
        {expandable ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-expanded={expanded}
            aria-label={
              expanded ? 'Collapse log message' : 'Expand log message'
            }
            data-expand-control
            onClick={e => {
              e.stopPropagation();
              onToggleExpand();
            }}
          >
            <ChevronRight
              className={cn(
                'motion-transform-standard-reduced size-3.5',
                expanded && 'rotate-90',
              )}
              aria-hidden="true"
            />
          </Button>
        ) : null}
      </TableCell>
      <TableCell className="w-[112px] px-3 py-1 align-top font-mono text-sm whitespace-nowrap">
        {formatTimestamp(log.createdAt)}
      </TableCell>
      <TableCell className="w-[80px] px-3 py-1 align-top text-sm">
        <LevelChip level={log.level} />
      </TableCell>
      <TableCell className="w-[160px] truncate px-3 py-1 align-top font-mono text-sm">
        {log.nodeId || '-'}
      </TableCell>
      <TableCell
        data-log-message
        className="min-w-0 px-3 py-1 align-top text-sm select-text"
      >
        <div
          className={cn(
            'motion-height-standard overflow-hidden',
            expanded ? 'h-auto' : 'h-5',
          )}
        >
          <p
            className={cn(
              'm-0',
              expanded ? 'break-words whitespace-pre-wrap' : 'truncate',
            )}
          >
            {log.message}
          </p>
        </div>
      </TableCell>
      <TableCell className="w-9 px-1 py-1 align-top" data-stop-row-toggle>
        <CopyButton value={log.message} label="Copy message" />
      </TableCell>
    </TableRow>
  );
}

export interface LogsPanelProps {
  logs: ExecutionLog[];
  compact?: boolean;
  className?: string;
}

export function LogsPanel({ logs, compact, className }: LogsPanelProps) {
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [nodeFilter, setNodeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const { expandedKeys, toggleExpanded } = useExpandedKeys();

  const nodeIds = useMemo(() => {
    const ids = new Set<string>();
    logs.forEach(log => {
      if (log.nodeId) {
        ids.add(log.nodeId);
      }
    });
    return Array.from(ids);
  }, [logs]);

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      if (levelFilter !== 'all' && log.level !== levelFilter) {
        return false;
      }
      if (nodeFilter !== 'all' && log.nodeId !== nodeFilter) {
        return false;
      }

      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (
          !log.message.toLowerCase().includes(query) &&
          !log.nodeId?.toLowerCase().includes(query)
        ) {
          return false;
        }
      }

      return true;
    });
  }, [levelFilter, logs, nodeFilter, searchQuery]);

  const filtersControl = (
    <>
      <OutlinedSelect
        label="Level"
        value={levelFilter}
        onValueChange={setLevelFilter}
        className={compact ? 'min-w-[80px]' : 'min-w-[120px]'}
      >
        <SelectItem value="all">All</SelectItem>
        <SelectItem value="debug">Debug</SelectItem>
        <SelectItem value="info">Info</SelectItem>
        <SelectItem value="warn">Warning</SelectItem>
        <SelectItem value="error">Error</SelectItem>
      </OutlinedSelect>
      {!compact && (
        <OutlinedSelect
          label="Node"
          value={nodeFilter}
          onValueChange={setNodeFilter}
          className="min-w-[170px]"
        >
          <SelectItem value="all">All nodes</SelectItem>
          {nodeIds.map(nodeId => (
            <SelectItem key={nodeId} value={nodeId}>
              {nodeId}
            </SelectItem>
          ))}
        </OutlinedSelect>
      )}
    </>
  );

  const searchControl = (
    <div className="relative w-full max-w-[240px]">
      <Search
        className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        placeholder="Search logs"
        aria-label="Search logs"
        value={searchQuery}
        onChange={event => setSearchQuery(event.target.value)}
        className="pl-7"
      />
    </div>
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          'log-panel-interpolate-size',
          compact ? 'flex flex-col' : 'flex min-h-0 flex-1 flex-col gap-3',
          className,
        )}
      >
        <div className="shrink-0 border-b border-border pb-2">
          <div className="flex flex-row items-center gap-2">
            <div className="flex flex-1 items-center gap-2">
              {filtersControl}
            </div>
            {searchControl}
          </div>
        </div>

        {filteredLogs.length === 0 && (
          <div className="p-6 text-center">
            <p className="text-sm text-muted-foreground">No logs to display</p>
          </div>
        )}

        {filteredLogs.length > 0 && compact && (
          <CompactLogsList logs={filteredLogs} />
        )}

        {filteredLogs.length > 0 && !compact && (
          <StickToBottom
            className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border"
            initial="instant"
            resize="instant"
            role="log"
            aria-label="Workflow execution logs"
          >
            <StickToBottom.Content>
              {/*
              Plain <table> — @roadiehq/ui Table wraps in overflow-auto, which
              competes with StickToBottom's scroll root and breaks follow-scroll.
            */}
              <table className="w-full table-fixed caption-bottom text-sm">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-6 px-1 py-1.5" />
                    <TableHead
                      className={cn('w-[112px]', INNER_TABLE_HEAD_CELL)}
                    >
                      Time
                    </TableHead>
                    <TableHead
                      className={cn('w-[80px]', INNER_TABLE_HEAD_CELL)}
                    >
                      Level
                    </TableHead>
                    <TableHead
                      className={cn('w-[160px]', INNER_TABLE_HEAD_CELL)}
                    >
                      Node
                    </TableHead>
                    <TableHead className={INNER_TABLE_HEAD_CELL}>
                      Message
                    </TableHead>
                    <TableHead className="w-9 px-1 py-1.5" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs.map(log => {
                    const key = logKey(log);
                    return (
                      <TableLogRow
                        key={key}
                        log={log}
                        expanded={expandedKeys.has(key)}
                        onToggleExpand={() => toggleExpanded(key)}
                      />
                    );
                  })}
                </TableBody>
              </table>
            </StickToBottom.Content>
            <UnreadAwarePill totalLogs={filteredLogs.length} />
          </StickToBottom>
        )}
      </div>
    </TooltipProvider>
  );
}

function UnreadAwarePill({ totalLogs }: { totalLogs: number }) {
  const { isAtBottom } = useStickToBottomContext();
  const lastSeenAtBottomRef = useRef(totalLogs);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (lastSeenAtBottomRef.current > totalLogs) {
      lastSeenAtBottomRef.current = totalLogs;
    }
    if (isAtBottom) {
      lastSeenAtBottomRef.current = totalLogs;
      setUnread(0);
      return;
    }
    setUnread(Math.max(0, totalLogs - lastSeenAtBottomRef.current));
  }, [isAtBottom, totalLogs]);

  return <ScrollToBottomPill unreadCount={unread} />;
}
