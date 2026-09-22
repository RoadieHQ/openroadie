import type { HarnessNormalizer, NormalizedSessionEvent } from './types';

// Cursor uses camelCase event names
const EVENT_MAP: Record<string, string> = {
  sessionStart: 'session.started',
  sessionEnd: 'session.ended',
  beforeSubmitPrompt: 'prompt.submitted',
  preToolUse: 'tool.requested',
  postToolUse: 'tool.used',
  postToolUseFailure: 'tool.failed',
  subagentStart: 'subagent.started',
  subagentStop: 'subagent.ended',
  stop: 'turn.completed',
  afterAgentResponse: 'turn.completed',
  beforeMCPExecution: 'tool.requested',
  afterMCPExecution: 'tool.used',
};

export const cursorNormalizer: HarnessNormalizer = {
  harness: 'cursor',

  normalize(body): NormalizedSessionEvent | undefined {
    const hookEvent = body.hook_event_name as string | undefined;
    if (!hookEvent) return undefined;

    const eventType = EVENT_MAP[`${hookEvent}`];
    if (!eventType) return undefined;

    // Cursor uses conversation_id instead of session_id
    const sessionId =
      (body.conversation_id as string) ?? (body.session_id as string);
    if (!sessionId) return undefined;

    return {
      sessionId,
      eventType,
      model: body.model as string | undefined,
      toolName: body.tool_name as string | undefined,
      // Cursor uses generation_id as the turn identifier
      promptId: (body.generation_id as string) ?? undefined,
      agentId: body.agent_id as string | undefined,
      agentType: body.agent_type as string | undefined,
      payload: body,
    };
  },
};
