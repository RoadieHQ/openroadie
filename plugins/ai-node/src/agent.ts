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

import {
  ToolLoopAgent,
  type Agent,
  type Tool as AITool,
  type ModelMessage,
  type TypedToolCall,
  type TypedToolResult,
  type ToolChoice,
  type ToolSet,
  type LanguageModel,
  type LanguageModelUsage,
} from 'ai';
import type { LanguageModelV2, LanguageModelV3 } from '@ai-sdk/provider';
import { AgenticModelRef } from './models';

export type AIAgent = Agent<never, ToolSet, never>;

export { ToolLoopAgent };
export type LLMModel = LanguageModel;

function isLanguageModelObject(
  model: LanguageModel,
): model is LanguageModelV2 | LanguageModelV3 {
  return typeof model === 'object' && model !== null && 'modelId' in model;
}

export function getModelId(model: LanguageModel): string {
  if (typeof model === 'string') {
    return model;
  }
  if (isLanguageModelObject(model)) {
    return model.modelId;
  }
  return 'unknown';
}

export class AIContext extends Map<string, unknown> {}

export type Tool = AITool;

export type AgentConfig = {
  id: string;
  name: string;
  description?: string;
  system: string;
  promptPrefix?: string;
  promptSuffix?: string;
  model: AgenticModelRef;
  tools?: Record<string, Tool>;
  maxSteps?: number;
  allowToolsOnLastStep?: boolean;
  toolChoice?: ToolChoice<Record<string, Tool>>;
};

export type AgentStepUsage = LanguageModelUsage;

export type AgentToolCall = TypedToolCall<Record<string, Tool>>;

export type AgentToolResult = TypedToolResult<Record<string, Tool>>;

export type AgentMessage = ModelMessage;

import type { ReasoningPart as AIReasoningPart } from '@ai-sdk/provider-utils';

export type ReasoningPart = AIReasoningPart;

export interface AgentTraceHandle {
  span(data: { name: string; input?: unknown; output?: unknown }): void;
  update(data: Record<string, unknown>): void;
}

export interface AgentGenerationHandle {
  end(data?: Record<string, unknown>): void;
}

export interface TracingHandleStepsOptions {
  trace: AgentTraceHandle;
  generation: AgentGenerationHandle;
  steps: unknown[];
  startTime: Date;
  response?: unknown;
  usage?: unknown;
  runId?: string;
}

export type AgentTraceData = {
  trace?: AgentTraceHandle;
  generation?: AgentGenerationHandle;
};
