import React from 'react';
import { Check, X, Zap } from 'lucide-react';
import { cn } from '@roadiehq/ui/utils';
import type { McpAuditLogEntry } from '../../api/mcp-audit';
import { isEscalation, extractEscalationInfo, formatDuration } from './helpers';

interface EscalationSummaryProps {
  entries: McpAuditLogEntry[];
}

export function EscalationSummary({ entries }: EscalationSummaryProps) {
  const escalations = entries.filter(isEscalation);
  if (escalations.length === 0) return null;

  return (
    <div className="space-y-2">
      <h4 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <Zap className="size-3.5 text-warning" />
        Escalations ({escalations.length})
      </h4>
      <div className="rounded-md border border-border">
        {escalations.map((entry, i) => {
          const info = extractEscalationInfo(entry);
          return (
            <div
              key={entry.id}
              className={cn(
                'flex items-center gap-3 px-3 py-2 text-sm',
                i > 0 && 'border-t border-border',
              )}
            >
              <span className="shrink-0 font-medium text-foreground">
                {info?.integrationSlug || '—'}
              </span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {info?.method}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                {info?.path}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {formatDuration(entry.durationMs)}
              </span>
              {entry.status === 'error' ? (
                <X className="size-3.5 shrink-0 text-destructive" />
              ) : (
                <Check className="size-3.5 shrink-0 text-success" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
