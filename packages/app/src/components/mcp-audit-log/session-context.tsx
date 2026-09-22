import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bot,
  BrainCircuit,
  ChevronRight,
  Info,
  MessagesSquare,
  MessageSquare,
  User,
} from 'lucide-react';
import { Badge } from '@roadiehq/ui/badge';
import { Button } from '@roadiehq/ui/button';
import { cn } from '@roadiehq/ui/utils';
import { useMcpAudit } from '../../api';
import type { SessionTelemetryEvent } from '../../api/mcp-audit';
import type { CorrelationGroup } from './types';
import { formatFull } from './helpers';
import { workspaceQueryKey } from '../../api/workspace-scope';

const HARNESS_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  opencode: 'OpenCode',
};

function PromptEvent({ event }: { event: SessionTelemetryEvent }) {
  const [expanded, setExpanded] = useState(false);
  const prompt =
    (event.payload?.user_prompt as string) ?? (event.payload?.prompt as string);
  if (!prompt) return null;

  const isLong = prompt.length > 120;

  return (
    <div className="flex gap-2">
      <User className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <Button
          variant="ghost"
          className="h-auto w-full items-start gap-2 rounded-none p-0 text-left font-normal hover:bg-transparent"
          onClick={() => isLong && setExpanded(e => !e)}
        >
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatFull(event.createdAt)}
          </span>
          {isLong && (
            <ChevronRight
              className={cn(
                'motion-transform-standard mt-0.5 size-3.5 shrink-0 text-muted-foreground',
                expanded && 'rotate-90',
              )}
            />
          )}
        </Button>
        {!isLong || expanded ? (
          <pre className="mt-1 max-h-60 overflow-auto rounded-md bg-muted/50 p-2 text-xs break-words whitespace-pre-wrap text-foreground">
            {prompt}
          </pre>
        ) : (
          <p className="mt-1 truncate text-xs text-foreground">{prompt}</p>
        )}
      </div>
    </div>
  );
}

function SubagentEvent({ event }: { event: SessionTelemetryEvent }) {
  const started = event.eventType === 'subagent.started';
  return (
    <div className="flex items-center gap-2">
      <BrainCircuit className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="text-xs text-muted-foreground">
        {formatFull(event.createdAt)}
      </span>
      <span className="text-xs text-foreground">
        {started ? 'Spawned' : 'Completed'}{' '}
        <span className="font-medium">{event.agentType ?? 'subagent'}</span>
      </span>
    </div>
  );
}

function TurnEvent({ event }: { event: SessionTelemetryEvent }) {
  const [expanded, setExpanded] = useState(false);
  const message =
    (event.payload?.last_assistant_message as string) ??
    (event.payload?.lastAssistantMessage as string);
  const stopReason =
    (event.payload?.stop_reason as string) ??
    (event.payload?.stopReason as string);

  return (
    <div className="flex gap-2">
      <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <Button
          variant="ghost"
          className="h-auto w-full items-center gap-2 rounded-none p-0 text-left font-normal hover:bg-transparent"
          onClick={() => message && setExpanded(e => !e)}
        >
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatFull(event.createdAt)}
          </span>
          <span className="text-xs text-foreground">
            Turn ended
            {stopReason && (
              <span className="text-muted-foreground"> ({stopReason})</span>
            )}
          </span>
          {message && (
            <ChevronRight
              className={cn(
                'motion-transform-standard size-3.5 shrink-0 text-muted-foreground',
                expanded && 'rotate-90',
              )}
            />
          )}
        </Button>
        {expanded && message && (
          <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-muted/50 p-2 text-xs break-words whitespace-pre-wrap text-muted-foreground">
            {message}
          </pre>
        )}
      </div>
    </div>
  );
}

function isConversationEvent(e: SessionTelemetryEvent): boolean {
  return (
    e.eventType === 'prompt.submitted' ||
    e.eventType === 'subagent.started' ||
    e.eventType === 'subagent.ended' ||
    e.eventType === 'turn.completed'
  );
}

function TelemetryEvents({ events }: { events: SessionTelemetryEvent[] }) {
  return (
    <div className="space-y-2">
      {events.map(event => {
        switch (event.eventType) {
          case 'prompt.submitted':
            return <PromptEvent key={event.id} event={event} />;
          case 'subagent.started':
          case 'subagent.ended':
            return <SubagentEvent key={event.id} event={event} />;
          case 'turn.completed':
            return <TurnEvent key={event.id} event={event} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

export function SessionContext({ group }: { group: CorrelationGroup }) {
  const client = useMcpAudit();

  const from = new Date(
    new Date(group.earliestAt).getTime() - 60_000,
  ).toISOString();
  const to = new Date(
    new Date(group.latestAt).getTime() + 60_000,
  ).toISOString();

  const { data } = useQuery({
    queryKey: workspaceQueryKey(
      'mcpAuditLog',
      'sessionTelemetry',
      group.customerId,
      from,
      to,
    ),
    queryFn: () =>
      client.getSessionTelemetry({
        customerId: group.customerId,
        from,
        to,
      }),
    enabled: !!group.customerId,
  });

  const events = data?.items;
  if (!events || events.length === 0) {
    return (
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Info className="size-3.5 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          Session context (prompts, model, agent) is available with telemetry
          enabled.{' '}
          <a
            href="/admin/mcp-servers"
            className="text-foreground underline underline-offset-2 hover:text-foreground/80"
          >
            Set up in MCP Servers
          </a>
        </p>
      </div>
    );
  }

  const sessionStart = events.find(e => e.eventType === 'session.started');
  const harness = sessionStart?.harness ?? events[0]?.harness;
  const model = sessionStart?.model ?? events.find(e => e.model)?.model;
  const harnessLabel = harness
    ? (HARNESS_LABELS[`${harness}`] ?? harness)
    : undefined;
  const conversationEvents = events.filter(isConversationEvent);

  return (
    <div className="space-y-3 border-b border-border px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Bot className="size-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">
            Session context
          </span>
        </div>
        {harnessLabel && (
          <Badge variant="outline" className="text-xs font-normal">
            {harnessLabel}
          </Badge>
        )}
        {model && (
          <Badge variant="outline" className="text-xs font-normal">
            {model}
          </Badge>
        )}
        {typeof sessionStart?.payload?.source === 'string' && (
          <Badge variant="outline" className="text-xs font-normal">
            {sessionStart.payload.source}
          </Badge>
        )}
      </div>

      {conversationEvents.length > 0 && (
        <>
          <div className="flex items-center gap-1.5">
            <MessagesSquare className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">
              Conversation
            </span>
          </div>
          <TelemetryEvents events={conversationEvents} />
        </>
      )}
    </div>
  );
}
