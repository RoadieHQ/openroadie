export interface NormalizedSessionEvent {
  sessionId: string;
  eventType: string;
  model?: string;
  toolName?: string;
  promptId?: string;
  agentId?: string;
  agentType?: string;
  payload: Record<string, unknown>;
}

export interface HarnessNormalizer {
  harness: string;
  normalize(body: Record<string, unknown>): NormalizedSessionEvent | undefined;
}
