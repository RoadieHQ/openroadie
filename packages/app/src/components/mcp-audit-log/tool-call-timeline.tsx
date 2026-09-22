import React, { useState } from 'react';
import { Check, ChevronRight, Circle, X, Zap } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { cn } from '@roadiehq/ui/utils';
import type { McpAuditLogEntry } from '../../api/mcp-audit';
import {
  isEscalation,
  extractEscalationInfo,
  formatOffsetMs,
  formatDuration,
  formatTokens,
} from './helpers';

function formatOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  return JSON.stringify(output, null, 2);
}

function TimelineEntry({
  entry,
  offsetMs,
  isLast,
}: {
  entry: McpAuditLogEntry;
  offsetMs: number;
  isLast: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const escalation = isEscalation(entry);
  const escalationInfo = escalation ? extractEscalationInfo(entry) : null;
  const isError = entry.status === 'error';
  const hasOutput = entry.toolOutput !== undefined && entry.toolOutput !== null;
  const hasTokens = entry.inputTokens != null || entry.outputTokens != null;
  const hasDetail =
    !!entry.toolInput || hasOutput || (isError && !!entry.errorMessage);

  return (
    <div className="relative flex gap-3">
      {!isLast && (
        <div className="absolute top-6 bottom-0 left-[9px] w-px bg-border" />
      )}

      <div className="relative z-10 mt-0.5 shrink-0">
        {escalation ? (
          <div className="flex size-[18px] items-center justify-center rounded-full bg-warning/10">
            <Zap className="size-3 text-warning" />
          </div>
        ) : isError ? (
          <div className="flex size-[18px] items-center justify-center">
            <Circle className="size-2.5 fill-destructive text-destructive" />
          </div>
        ) : (
          <div className="flex size-[18px] items-center justify-center">
            <Circle className="size-2.5 fill-success text-success" />
          </div>
        )}
      </div>

      <div className="mb-4 min-w-0 flex-1">
        <Button
          variant="ghost"
          className="h-auto w-full items-center gap-2 rounded-none p-0 text-left font-normal hover:bg-transparent"
          onClick={() => setExpanded(e => !e)}
        >
          <span className="w-16 shrink-0 text-xs text-muted-foreground tabular-nums">
            {formatOffsetMs(offsetMs)}
          </span>
          <span
            className={cn(
              'min-w-0 truncate text-sm font-medium',
              escalation && 'text-warning',
            )}
          >
            {entry.tool}
          </span>
          {hasTokens && (
            <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
              {formatTokens(entry.inputTokens ?? 0)} /{' '}
              {formatTokens(entry.outputTokens ?? 0)} tok
            </span>
          )}
          <span
            className={cn(
              'shrink-0 text-xs text-muted-foreground tabular-nums',
              !hasTokens && 'ml-auto',
            )}
          >
            {formatDuration(entry.durationMs)}
          </span>
          {isError ? (
            <X className="size-3.5 shrink-0 text-destructive" />
          ) : (
            <Check className="size-3.5 shrink-0 text-success" />
          )}
          {hasDetail && (
            <ChevronRight
              className={cn(
                'motion-transform-standard size-3.5 shrink-0 text-muted-foreground',
                expanded && 'rotate-90',
              )}
            />
          )}
        </Button>

        {escalation && escalationInfo && escalationInfo.method && (
          <div className="mt-0.5 flex items-center gap-1 text-xs text-warning">
            <span className="font-medium">ESCALATION</span>
            <span className="text-muted-foreground">—</span>
            <span className="min-w-0 truncate font-mono">
              {escalationInfo.method} {escalationInfo.integrationSlug}{' '}
              {escalationInfo.path}
            </span>
          </div>
        )}

        {isError && entry.errorMessage && (
          <p className="mt-0.5 text-xs text-destructive">
            {entry.errorMessage}
          </p>
        )}

        {expanded && entry.toolInput && (
          <div className="mt-2">
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Input{' '}
              {entry.inputTokens != null && (
                <span className="tabular-nums">
                  ({formatTokens(entry.inputTokens)} tokens)
                </span>
              )}
            </p>
            <pre className="max-h-60 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
              {JSON.stringify(entry.toolInput, null, 2)}
            </pre>
          </div>
        )}

        {expanded && hasOutput && (
          <div className="mt-2">
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Output{' '}
              {entry.outputTokens != null && (
                <span className="tabular-nums">
                  ({formatTokens(entry.outputTokens)} tokens)
                </span>
              )}
            </p>
            <pre className="max-h-60 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
              {formatOutput(entry.toolOutput)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

interface ToolCallTimelineProps {
  entries: McpAuditLogEntry[];
  earliestAt: string;
}

export function ToolCallTimeline({
  entries,
  earliestAt,
}: ToolCallTimelineProps) {
  const earliestMs = new Date(earliestAt).getTime();

  return (
    <div className="py-2">
      {entries.map((entry, i) => (
        <TimelineEntry
          key={entry.id}
          entry={entry}
          offsetMs={new Date(entry.createdAt).getTime() - earliestMs}
          isLast={i === entries.length - 1}
        />
      ))}
    </div>
  );
}
