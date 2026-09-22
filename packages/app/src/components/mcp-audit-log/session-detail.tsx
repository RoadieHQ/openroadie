import React from 'react';
import { ScrollText, Terminal, Zap } from 'lucide-react';
import { Badge } from '@roadiehq/ui/badge';
import { InlineCode } from '@roadiehq/ui/inline-code';
import { EmptyState } from '@roadiehq/ui/empty-state';
import type { CorrelationGroup } from './types';
import { formatFull, formatDuration, formatTokens } from './helpers';
import { useResolveCustomerName } from './token-name-context';
import { ToolCallTimeline } from './tool-call-timeline';
import { EscalationSummary } from './escalation-summary';
import { SessionContext } from './session-context';

function SessionDetailHeader({ group }: { group: CorrelationGroup }) {
  const resolveCustomerName = useResolveCustomerName();
  const durationMs =
    new Date(group.latestAt).getTime() - new Date(group.earliestAt).getTime();

  return (
    <div className="space-y-3 border-b border-border px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">
          {group.entries.length} call{group.entries.length !== 1 ? 's' : ''}
        </span>
        <span className="text-sm text-muted-foreground">—</span>
        {group.services.map(s => (
          <Badge key={s} variant="outline" className="text-xs">
            {s}
          </Badge>
        ))}
        {group.successCount > 0 && (
          <Badge variant="successOutline" className="text-xs">
            {group.successCount} success
          </Badge>
        )}
        {group.errorCount > 0 && (
          <Badge variant="destructive" className="text-xs">
            {group.errorCount} error{group.errorCount !== 1 ? 's' : ''}
          </Badge>
        )}
        {group.escalationCount > 0 && (
          <Badge variant="warningSubtle" icon={<Zap />} className="text-xs">
            {group.escalationCount} escalation
            {group.escalationCount !== 1 ? 's' : ''}
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <span>{resolveCustomerName(group.customerId)}</span>
        <span>·</span>
        <span>{formatFull(group.earliestAt)}</span>
        {durationMs > 0 && (
          <>
            <span>·</span>
            <span className="tabular-nums">{formatDuration(durationMs)}</span>
          </>
        )}
        {(group.inputTokens > 0 || group.outputTokens > 0) && (
          <>
            <span>·</span>
            <span className="tabular-nums">
              {formatTokens(group.inputTokens)} in /{' '}
              {formatTokens(group.outputTokens)} out tokens
            </span>
          </>
        )}
      </div>

      <div className="text-xs text-muted-foreground">
        Session <InlineCode>{group.correlationId}</InlineCode>
      </div>
    </div>
  );
}

export function SessionDetail({ group }: { group: CorrelationGroup | null }) {
  if (!group) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<ScrollText className="h-8 w-8" />}
          title="Select a session to view details"
          description="Click a session in the list to see the tool call timeline."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <SessionDetailHeader group={group} />
      <SessionContext group={group} />
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mb-3 flex items-center gap-1.5">
          <Terminal className="size-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">
            Tool calls
          </span>
          <span className="text-xs text-muted-foreground">
            ({group.entries.length})
          </span>
        </div>
        <ToolCallTimeline
          entries={group.entries}
          earliestAt={group.earliestAt}
        />
        {group.escalationCount > 0 && (
          <div className="mt-4 border-t border-border pt-4">
            <EscalationSummary entries={group.entries} />
          </div>
        )}
      </div>
    </div>
  );
}
