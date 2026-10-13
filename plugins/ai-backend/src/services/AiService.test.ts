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

import { tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModelV4GenerateResult } from '@ai-sdk/provider';
import z from 'zod/v4';
import type { Config } from '@roadiehq/config';
import type { LoggerService } from '@roadiehq/extensions-api';
import { MODEL_TIER, type AgentCallOptions } from '@roadiehq/ai-node';
import { DefaultAiService } from './AiService';
import { DefaultAgentService } from './AgentService';
import { InferenceModelService } from './InferenceModelService';
import { DefaultAgentRegistry } from './registries/AgentRegistry';
import { DefaultToolsetRegistry } from './registries/ToolsetRegistry';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: () => logger,
} as unknown as LoggerService;

const config = {
  getOptionalBoolean: () => undefined,
} as unknown as Config;

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

const toolCallStep: LanguageModelV4GenerateResult = {
  content: [
    {
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'probe',
      input: JSON.stringify({}),
    },
  ],
  finishReason: { unified: 'tool-calls', raw: 'tool_use' },
  usage,
  warnings: [],
};

const textStep: LanguageModelV4GenerateResult = {
  content: [{ type: 'text', text: 'done' }],
  finishReason: { unified: 'stop', raw: 'end_turn' },
  usage,
  warnings: [],
};

// The registry is keyed by ref identity, so calls must reuse this object.
const agentRef = { id: 'test-agent' };

type AgentCall = Omit<AgentCallOptions, 'response'>;

function createService(model: MockLanguageModelV4, maxSteps = 4) {
  const agentRegistry = new DefaultAgentRegistry(logger);
  agentRegistry.registerAgent(agentRef, {
    id: 'test-agent',
    name: 'Test agent',
    system: 'You are a test agent.',
    model: MODEL_TIER.LARGE,
    maxSteps,
  });
  return new DefaultAiService(
    logger,
    new DefaultToolsetRegistry(logger),
    agentRegistry,
    { getModel: async () => model },
    new DefaultAgentService(logger, config),
    new InferenceModelService(logger),
    config,
  );
}

describe('DefaultAiService agent calls', () => {
  it('hands the runtime context to every tool execution', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [toolCallStep, textStep],
    });
    const execute = vi.fn(async () => 'ok');
    const runtimeContext = { token: 'secret-token', workspace: 'w1' };

    const call: AgentCall = {
      agentRef,
      query: 'go',
      runtimeContext,
      userId: 'user:default/test',
      tools: {
        probe: tool({
          description: 'probe',
          inputSchema: z.object({}),
          execute,
        }),
      },
    };
    const result = await createService(model).invoke(call);

    expect(result.text).toBe('done');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ context: runtimeContext }),
    );
  });

  it('swaps in the step-limit instructions and disables tools on the last step', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [toolCallStep, textStep],
    });

    const call: AgentCall = {
      agentRef,
      query: 'go',
      runtimeContext: {},
      userId: 'user:default/test',
      tools: {
        probe: tool({
          description: 'probe',
          inputSchema: z.object({}),
          execute: async () => 'ok',
        }),
      },
    };
    await createService(model, 2).invoke(call);

    const [first, last] = model.doGenerateCalls;
    const systemText = (call: typeof first) =>
      call.prompt
        .filter(message => message.role === 'system')
        .map(message => message.content)
        .join('\n');

    expect(systemText(first)).not.toContain('final reasoning step');
    expect(systemText(last)).toContain('final reasoning step (2/2)');
    expect(last.toolChoice).toEqual({ type: 'none' });
  });
});
