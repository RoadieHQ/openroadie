import React from 'react';
import { Zap } from 'lucide-react';
import { Badge } from '@roadiehq/ui/badge';
import { Button } from '@roadiehq/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';
import {
  StatusDot,
  type StatusIndicatorTone,
} from '@roadiehq/ui/status-indicator';
import { cn } from '@roadiehq/ui/utils';
import type { CorrelationGroup } from './types';
import { formatRelative, formatFull, formatDuration } from './helpers';
import { useResolveCustomerName } from './token-name-context';

function sessionTone(group: CorrelationGroup): StatusIndicatorTone {
  if (group.errorCount === 0) return 'success';
  if (group.successCount === 0) return 'destructive';
  return 'warning';
}

function SessionCard({
  group,
  selected,
  onSelect,
}: {
  group: CorrelationGroup;
  selected: boolean;
  onSelect: () => void;
}) {
  const resolveCustomerName = useResolveCustomerName();
  const durationMs =
    new Date(group.latestAt).getTime() - new Date(group.earliestAt).getTime();

  return (
    <Button
      variant="ghost"
      className={cn(
        'h-auto w-full flex-col items-stretch gap-1.5 rounded-none border-b border-border px-4 py-3 text-left font-normal hover:bg-muted/60',
        selected && 'border-l-2 border-l-primary bg-muted/40',
      )}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2">
        <StatusDot tone={sessionTone(group)} className="size-2.5" />
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-sm text-foreground">
                {formatRelative(group.latestAt)}
              </span>
            </TooltipTrigger>
            <TooltipContent>{formatFull(group.latestAt)}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <span className="text-sm text-muted-foreground tabular-nums">
          {group.entries.length} call{group.entries.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {group.services.map(s => (
          <Badge key={s} variant="outline" className="text-xs">
            {s}
          </Badge>
        ))}
      </div>

      <p className="truncate text-xs text-muted-foreground">
        {[...new Set(group.entries.map(e => e.tool))].join(', ')}
      </p>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">
          {resolveCustomerName(group.customerId)}
        </span>
        {group.escalationCount > 0 && (
          <Badge
            variant="warningSubtle"
            icon={<Zap />}
            className="shrink-0 text-xs"
          >
            {group.escalationCount} escal.
          </Badge>
        )}
        {durationMs > 0 && (
          <span className="ml-auto shrink-0 tabular-nums">
            took {formatDuration(durationMs)}
          </span>
        )}
      </div>
    </Button>
  );
}

interface SessionListProps {
  groups: CorrelationGroup[];
  selectedId: string | null;
  onSelect: (correlationId: string) => void;
}

export function SessionList({
  groups,
  selectedId,
  onSelect,
}: SessionListProps) {
  return (
    <div className="flex flex-col">
      {groups.map(group => (
        <SessionCard
          key={group.correlationId}
          group={group}
          selected={group.correlationId === selectedId}
          onSelect={() => onSelect(group.correlationId)}
        />
      ))}
    </div>
  );
}
