/*
 * Copyright 2025 Larder Software Ltd.
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

import {
  AgentConfig,
  LLMModel,
  AIAgent,
  Tool,
  AgentMessage,
  AgentTraceData,
} from './agent';
import { AgentUIMessage } from './ui';
import { createServiceRef } from '@roadiehq/extensions-api';
import { AgenticModelRef, InferenceModelRef, ModelRef } from './models';
import { ServerResponse } from 'http';
import { experimental_MCPClientConfig as MCPClientConfig } from '@ai-sdk/mcp';

export type McpClientOptionsBuilder = (
  runtimeContext: Record<string, unknown>,
) => Promise<MCPClientConfig>;

export const aiServiceRef = createServiceRef<AiService>({
  id: 'ai.service',
});

export interface AgentCallOptions {
  agentRef: AgentRef;
  query: string | AgentMessage[];
  runtimeContext: Record<string, unknown>;
  response: ServerResponse;
  tools?: Record<string, Tool>;
  system?: string;
  userId: string;
  originalMessages?: AgentUIMessage[];
  onFinish?: (result: { messages: AgentUIMessage[] }) => Promise<void>;
}

export interface ModelCallOptions {
  model: LLMModel;
  query: string;
  response: ServerResponse;
  userId: string;
}

export type AiCallOptions = ModelCallOptions | AgentCallOptions;

export function isAgentCallOptions(
  options: Omit<AiCallOptions, 'response'>,
): options is Omit<AgentCallOptions, 'agent'> & { agentRef: AgentRef } {
  return 'agentRef' in options && 'runtimeContext' in options;
}

export function isModelCallOptions(
  options: Omit<AiCallOptions, 'response'>,
): options is ModelCallOptions {
  return 'model' in options && !('runtimeContext' in options);
}

export interface AiResponse {
  text: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export type CallableAiCallOptions =
  | ModelCallOptions
  | (Omit<Omit<AgentCallOptions, 'agentRef'> & { agent: AIAgent }, 'invoke'> & {
      tools?: Record<string, Tool>;
      model?: LLMModel;
    });

export interface CallableAiService<T = CallableAiCallOptions> {
  stream(options: T): Promise<void>;
  streamUI(options: T): Promise<void>;
  invoke(options: Omit<T, 'response'>): Promise<AiResponse>;
}

export interface ModelService extends CallableAiService<ModelCallOptions> {}
export interface AgentService extends CallableAiService<
  Omit<Omit<AgentCallOptions, 'agentRef'> & { agent: AIAgent }, 'invoke'> & {
    tools?: Record<string, Tool>;
  }
> {
  readonly langfuse?: unknown;
  getTracer?(params: {
    agent: AIAgent;
    model: LLMModel;
    agentId: string;
    messages: AgentMessage[];
    type: string;
    userId: string;
  }): AgentTraceData;
}

export type AgentRef = {
  id: string;
};

export type ToolsetRef = {
  id: string;
};

export interface GenerateObjectOptions<_T = unknown> {
  model: LLMModel;
  schema: unknown;
  prompt: string;
  userId: string;
}

export interface GenerateObjectResult<T> {
  object: T;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface StreamObjectOptions<_T = unknown> {
  model: LLMModel;
  schema: unknown;
  prompt: string;
  response: ServerResponse;
  userId: string;
}

export interface AiService {
  stream(options: AiCallOptions): Promise<void>;
  streamUI(options: AiCallOptions): Promise<void>;
  invoke(
    options:
      | Omit<ModelCallOptions, 'response'>
      | Omit<AgentCallOptions, 'response'>,
  ): Promise<AiResponse>;

  generateObject<T>(
    options: GenerateObjectOptions<T>,
  ): Promise<GenerateObjectResult<T>>;

  streamObject<T>(options: StreamObjectOptions<T>): Promise<void>;

  convertToModelMessages(messages: AgentUIMessage[]): Promise<AgentMessage[]>;
  validateUIMessages(messages: unknown): Promise<AgentUIMessage[]>;

  getModel(id: ModelRef): Promise<LLMModel | undefined>;
  getInferenceModel(id: InferenceModelRef): Promise<LLMModel>;
  getAgenticModel(id: AgenticModelRef): Promise<LLMModel>;

  invokeModel(
    opts: Omit<ModelCallOptions, 'model' | 'response'> & {
      model: InferenceModelRef;
    },
  ): Promise<AiResponse>;

  getToolsetRegistry(): ToolsetRegistry;
  getToolsets(): Map<ToolsetRef, ToolsetBuilder>;
  getToolset(ref: ToolsetRef): ToolsetBuilder | undefined;

  getAgentRegistry(): AgentRegistry;
  getAgents(): Map<AgentRef, AgentConfig>;
  getAgent(ref: AgentRef): AgentConfig | undefined;
  getExposedAgents(): Map<string, AgentRef>;
}

export interface AgentRegistry {
  registerAgent(ref: AgentRef, agent: AgentConfig): void;
  getAgent(ref: AgentRef): AgentConfig | undefined;
  exposeAgent(ref: AgentRef, path: string): void;
  getExposedAgents(): Map<string, AgentRef>;
  getAttachedToolsets(ref: AgentRef): Array<ToolsetRef>;
  attachToolset(ref: AgentRef, toolsetRef: ToolsetRef): void;
  listAgents(): AgentRef[];
  getAgents(): Map<AgentRef, AgentConfig>;
}

export interface ToolsetBuilder {
  connect?: (opts: AgentCallOptions) => Promise<void>;
  disconnect?: () => void;
  getToolset: () => Promise<Record<string, Tool>>;
}

export interface ToolsetRegistry {
  registerToolset(
    ref: ToolsetRef,
    toolset: ToolsetBuilder | Record<string, Tool>,
  ): void;
  getToolsetBuilder(ref: ToolsetRef): ToolsetBuilder | undefined;
  listToolsetBuilders(): ToolsetRef[];
  getToolsetBuilders(): Map<ToolsetRef, ToolsetBuilder>;
}
