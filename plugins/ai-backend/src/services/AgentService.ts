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
import { LoggerService } from '@roadiehq/extensions-api';
import { Config } from '@roadiehq/config';
import {
  AgentCallOptions,
  AgentService,
  AIAgent,
  AiResponse,
  LLMModel,
  AgentMessage,
  AgentTraceData,
  AgentUIMessage,
} from '@roadiehq/ai-node';
import {
  createIdGenerator,
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
} from 'ai';

export class DefaultAgentService implements AgentService {
  private readonly reasoningEnabled: boolean;

  constructor(
    private readonly logger: LoggerService,
    config: Config,
  ) {
    this.reasoningEnabled = config.getOptionalBoolean('ai.reasoning') ?? false;
  }

  async stream({
    agent,
    query,
    response,
  }: Omit<Omit<AgentCallOptions, 'agentRef'> & { agent: AIAgent }, 'invoke'>) {
    this.logger.debug(`Streaming response for query: ${query}`);

    const streamResult = await agent.stream({
      prompt: query as string,
    });

    streamResult.pipeTextStreamToResponse(response);
  }

  async streamUI({
    agent,
    query,
    originalMessages,
    response,
    onFinish,
  }: Omit<Omit<AgentCallOptions, 'agentRef'> & { agent: AIAgent }, 'invoke'> & {
    originalMessages?: AgentUIMessage[];
    onFinish?: (result: { messages: AgentUIMessage[] }) => Promise<void>;
  }) {
    this.logger.debug(`Streaming UI response for query: ${query}`);

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        const streamResult = await agent.stream({
          messages: query as AgentMessage[],
        });

        writer.merge(
          streamResult.toUIMessageStream({
            sendReasoning: this.reasoningEnabled,
            sendStart: false,
            sendFinish: false,
          }),
        );
      },
      originalMessages: (originalMessages || query) as AgentUIMessage[],
      generateId: createIdGenerator({ prefix: 'msg', size: 16 }),
      onFinish: onFinish
        ? async ({ messages }: { messages: AgentUIMessage[] }) => {
            await onFinish({ messages });
          }
        : undefined,
    });

    pipeUIMessageStreamToResponse({
      response,
      stream,
      status: 200,
    });
  }

  async invoke({
    agent,
    query,
  }: Omit<
    Omit<AgentCallOptions, 'agentRef'> & { agent: AIAgent },
    'invoke'
  >): Promise<AiResponse> {
    this.logger.info(`Processing query: ${query}`);

    const result = await agent.generate({
      prompt: query as string,
    });
    const usage = result.usage;
    return {
      text: result.text || '',
      usage: {
        inputTokens: usage?.inputTokens || 0,
        outputTokens: usage?.outputTokens || 0,
        totalTokens: usage?.totalTokens || 0,
      },
    };
  }

  getTracer({
    model: _model,
    agentId: _agentId,
    messages: _messages,
    type: _type,
    usage: _usage,
    userId: _userId,
  }: {
    model: LLMModel;
    agentId: string;
    messages: AgentMessage[];
    type: string;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
    userId: string;
  }): AgentTraceData {
    return { trace: undefined, generation: undefined };
  }
}
