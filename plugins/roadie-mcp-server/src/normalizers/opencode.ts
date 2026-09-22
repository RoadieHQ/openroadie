import type { HarnessNormalizer, NormalizedSessionEvent } from './types';

// OpenCode uses dot-separated event names
const EVENT_MAP: Record<string, string> = {
  'session.created': 'session.started',
  'session.deleted': 'session.ended',
  'session.idle': 'turn.completed',
  'session.compacted': 'context.compacted',
  'session.error': 'session.error',
  'tool.execute.before': 'tool.requested',
  'tool.execute.after': 'tool.used',
  'message.updated': 'prompt.submitted',
  'permission.asked': 'permission.requested',
  'permission.replied': 'permission.replied',
};

export const opencodeNormalizer: HarnessNormalizer = {
  harness: 'opencode',

  normalize(body): NormalizedSessionEvent | undefined {
    const hookEvent = body.event as string | undefined;
    if (!hookEvent) return undefined;

    const eventType = EVENT_MAP[`${hookEvent}`];
    if (!eventType) return undefined;

    const sessionId = (body.sessionId as string) ?? (body.session_id as string);
    if (!sessionId) return undefined;

    return {
      sessionId,
      eventType,
      model: body.model as string | undefined,
      toolName: body.toolName as string | undefined,
      promptId: body.messageId as string | undefined,
      agentId: undefined,
      agentType: undefined,
      payload: body,
    };
  },
};
