import type { HarnessNormalizer, NormalizedSessionEvent } from './types';

const EVENT_MAP: Record<string, string> = {
  SessionStart: 'session.started',
  SessionEnd: 'session.ended',
  UserPromptSubmit: 'prompt.submitted',
  PostToolUse: 'tool.used',
  PostToolUseFailure: 'tool.failed',
  SubagentStart: 'subagent.started',
  SubagentStop: 'subagent.ended',
  Stop: 'turn.completed',
  PostToolBatch: 'tool.batch.completed',
};

export const claudeCodeNormalizer: HarnessNormalizer = {
  harness: 'claude-code',

  normalize(body): NormalizedSessionEvent | undefined {
    const hookEvent = body.hook_event_name as string | undefined;
    if (!hookEvent) return undefined;

    const eventType = EVENT_MAP[`${hookEvent}`];
    if (!eventType) return undefined;

    return {
      sessionId: body.session_id as string,
      eventType,
      model: body.model as string | undefined,
      toolName: body.tool_name as string | undefined,
      promptId: body.prompt_id as string | undefined,
      agentId: body.agent_id as string | undefined,
      agentType: body.agent_type as string | undefined,
      payload: body,
    };
  },
};
