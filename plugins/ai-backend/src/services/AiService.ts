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
  AgenticModelRef,
  AgentRegistry,
  AgentService,
  AgentRef,
  AgentMessage,
  AiResponse,
  AiService,
  InferenceModelRef,
  isAgentCallOptions,
  isModelCallOptions,
  LLMModel,
  ModelCallOptions,
  ModelRef,
  ModelService,
  Tool,
  AiCallOptions,
  ToolsetBuilder,
  ToolsetRef,
  ToolsetRegistry,
  AgentConfig,
  AIAgent,
  AgentStepUsage,
  AgentToolCall,
  AgentToolResult,
  TracingHandleStepsOptions,
  AgentCallOptions,
  AgentUIMessage,
  ReasoningPart,
  GenerateObjectOptions,
  GenerateObjectResult,
  StreamObjectOptions,
} from '@roadiehq/ai-node';
import { LoggerService } from '@roadiehq/extensions-api';
import { ModelRegistry } from './registries/ModelRegistry';
import {
  ToolLoopAgent as Agent,
  stepCountIs,
  convertToModelMessages as AIconvertToModelMessages,
  validateUIMessages as AIvalidateUIMessages,
  generateText,
  generateObject,
  streamObject,
} from 'ai';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import z from 'zod/v4';
import type { Config } from '@roadiehq/config';

export class DefaultAiService implements AiService {
  private readonly preprocessingEnabled: boolean;

  constructor(
    private readonly logger: LoggerService,
    private readonly toolsetRegistry: ToolsetRegistry,
    private readonly agentRegistry: AgentRegistry,
    private readonly modelRegistry: ModelRegistry,
    private readonly agentService: AgentService,
    private readonly modelService: ModelService,
    config: Config,
  ) {
    this.preprocessingEnabled =
      config.getOptionalBoolean('ai.preprocessing.enabled') ?? false;
  }

  private extractTextFromQuery(query: string | AgentMessage[]): string {
    return typeof query === 'string'
      ? query
      : query
          .map(msg =>
            Array.isArray(msg.content)
              ? msg.content
                  .filter(block => block.type === 'text')
                  .map(block => block.text)
                  .join(' ')
              : msg.content,
          )
          .join('');
  }

  private extractTextFromResponse(result: {
    steps: Array<{ content: Array<{ type: string; text?: string }> }>;
  }): string {
    return result.steps[0].content
      .filter(
        (part): part is { type: 'text'; text: string } =>
          part.type === 'text' && typeof part.text === 'string',
      )
      .map(part => part.text)
      .join(' ');
  }

  private getProviderOptions(): ProviderOptions | undefined {
    return undefined;
  }

  getToolsetRegistry(): ToolsetRegistry {
    return this.toolsetRegistry;
  }
  getToolsets(): Map<ToolsetRef, ToolsetBuilder> {
    return this.toolsetRegistry.getToolsetBuilders();
  }
  getToolset(ref: ToolsetRef): ToolsetBuilder | undefined {
    return this.toolsetRegistry.getToolsetBuilder(ref);
  }

  async invoke(options: Omit<AiCallOptions, 'response'>): Promise<AiResponse> {
    if (isAgentCallOptions(options)) {
      this.logger.info(
        `Calling Agent: streaming response for query: ${options.query}`,
      );
      const agentConfig = this.agentRegistry.getAgent(options.agentRef);
      if (!agentConfig) {
        throw new Error(`Agent ${options.agentRef.id} not registered`);
      }
      const toolsetBuilders: ToolsetBuilder[] = [];

      try {
        let tools: Record<string, Tool> = options.tools ?? {};
        for (const ref of this.agentRegistry.getAttachedToolsets(
          options.agentRef,
        )) {
          const builder = this.toolsetRegistry.getToolsetBuilder(ref);
          if (!builder) {
            throw new Error(`Toolset ${ref.id} not registered`);
          }
          await builder.connect?.(options);
          toolsetBuilders.push(builder);
          tools = { ...tools, ...(await builder.getToolset()) };
        }

        const model = await this.modelRegistry.getModel(agentConfig.model);

        if (!model) {
          throw new Error(`Model ${agentConfig.model} not found`);
        }

        const messages = [
          { role: 'user' as const, content: options.query as string },
        ];

        const { trace, generation } = this.agentService.getTracer?.({
          agent: {} as AIAgent,
          model,
          agentId: agentConfig.id,
          userId: options.userId,
          messages: this.withSystemInstructions({
            messages,
            system: options.system || agentConfig.system,
          }),
          type: 'agent',
        }) || { trace: undefined, generation: undefined };

        const cumulativeUsage = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        };

        const cleanup = async () => {
          await Promise.all(
            toolsetBuilders.map(toolset => toolset.disconnect?.()),
          );

          if (generation) {
            generation.end({
              usage: {
                promptTokens: cumulativeUsage.inputTokens,
                completionTokens: cumulativeUsage.outputTokens,
                totalTokens: cumulativeUsage.totalTokens,
              },
            });
          }
        };

        const maxSteps = agentConfig.maxSteps || 4;

        const agent = new Agent({
          model,
          instructions: options.system || agentConfig.system,
          tools,
          toolChoice: agentConfig.toolChoice,
          stopWhen: stepCountIs(maxSteps),
          experimental_context: options.runtimeContext,
          providerOptions: this.getProviderOptions(),
          prepareStep: ({ stepNumber }) =>
            this.prepareAgentStep(
              stepNumber,
              maxSteps,
              options.system || agentConfig.system,
              agentConfig.allowToolsOnLastStep,
              tools,
            ),
          onStepFinish: ({
            text,
            toolCalls,
            toolResults,
            finishReason,
            usage,
            reasoning,
          }) => {
            if (usage) {
              cumulativeUsage.inputTokens += usage.inputTokens || 0;
              cumulativeUsage.outputTokens += usage.outputTokens || 0;
              cumulativeUsage.totalTokens += usage.totalTokens || 0;
            }

            this.handleStepTrace({
              text,
              toolCalls,
              toolResults,
              usage,
              finishReason,
              reasoning,
              trace,
            });

            if (finishReason === 'stop' || finishReason === 'error') {
              cleanup().catch(err => {
                this.logger.error('Error during agent cleanup:', err);
              });
            }
          },
        });

        const result = await this.agentService.invoke({
          ...options,
          agent,
        });

        if (generation) {
          generation.end({
            output: result.text,
            usage: {
              promptTokens: cumulativeUsage.inputTokens,
              completionTokens: cumulativeUsage.outputTokens,
              totalTokens: cumulativeUsage.totalTokens,
            },
          });
        }

        return result;
      } finally {
        await Promise.all(
          toolsetBuilders.map(toolset => toolset.disconnect?.()),
        );
      }
    }

    if (isModelCallOptions(options)) {
      return await this.modelService.invoke(options);
    }

    throw new Error('Unknown call options type');
  }

  async invokeModel(
    opts: Omit<ModelCallOptions, 'model' | 'response'> & {
      model: InferenceModelRef;
    },
  ): Promise<AiResponse> {
    const model = await this.modelRegistry.getModel(opts.model);
    if (!model) {
      throw new Error(`Model ${opts.model} not found`);
    }
    return await this.modelService.invoke({ ...opts, model });
  }

  async streamModel(
    opts: Omit<ModelCallOptions, 'model'> & { model: InferenceModelRef },
  ) {
    const model = await this.modelRegistry.getModel(opts.model);
    if (!model) {
      throw new Error(`Model ${opts.model} not found`);
    }
    return await this.modelService.stream({ ...opts, model });
  }

  async stream(opts: AiCallOptions) {
    if (isAgentCallOptions(opts)) {
      const agentOpts = opts as AgentCallOptions;
      this.logger.info(
        `Calling Agent: ${agentOpts.agentRef.id}: streaming response`,
      );

      const agent = await this.setupAgentForStreaming(agentOpts);
      await this.agentService.stream({
        ...agentOpts,
        agent,
      });
      return;
    }

    if (isModelCallOptions(opts)) {
      const modelOpts = opts as ModelCallOptions;
      this.logger.info(
        `Calling Model: streaming response for model: ${modelOpts.model}`,
      );
      await this.modelService.stream(modelOpts);
      return;
    }

    throw new Error('Unknown call options');
  }

  async streamUI(opts: AiCallOptions) {
    if (isAgentCallOptions(opts)) {
      const agentOpts = opts as AgentCallOptions;
      if (this.preprocessingEnabled) {
        const claudeModel = await this.modelRegistry.getModel('medium');
        const mistralModel = await this.modelRegistry.getModel('small');

        if (claudeModel && mistralModel) {
          const queryText = this.extractTextFromQuery(agentOpts.query);

          const { object } = await generateObject({
            model: claudeModel,
            schema: z.object({
              needsPreprocessing: z.boolean(),
              reason: z.string().optional(),
            }),
            prompt: `Analyze this query and determine if it needs preprocessing (spelling fixes, whitespace cleanup, conciseness improvements).

Query: "${queryText}"`,
          });

          try {
            this.logger.info(
              `Claude preprocessing decision: ${
                object.needsPreprocessing ? 'YES' : 'NO'
              } - ${object.reason || 'No reason provided'}`,
            );
          } catch {
            this.logger.warn(
              'Failed to parse preprocessing decision, skipping preprocessing',
            );
          }

          if (object.needsPreprocessing) {
            const result = await generateText({
              model: mistralModel,
              prompt: `Preprocess this query by fixing spelling, removing extra whitespaces and making it concise. Return ONLY a JSON object with this exact format: {"processedQuery": "cleaned_query"}
Input query: "${queryText}"`,
            });

            const responseText = this.extractTextFromResponse(result);

            const processedText = (() => {
              try {
                return JSON.parse(responseText).processedQuery || responseText;
              } catch {
                return responseText.trim();
              }
            })();

            agentOpts.query = [
              { role: 'user' as const, content: processedText },
            ];
          }
        }
      }

      this.logger.info(
        `Calling Agent UI: ${
          agentOpts.agentRef.id
        }: streaming response for ${JSON.stringify(agentOpts.query)}`,
      );

      const agent = await this.setupAgentForStreaming(agentOpts);

      await this.agentService.streamUI({
        ...agentOpts,
        agent,
      });
      return;
    }

    if (isModelCallOptions(opts)) {
      const modelOpts = opts as ModelCallOptions;
      this.logger.info(
        `Calling Model UI: streaming response for query: ${modelOpts.query}`,
      );
      await this.modelService.streamUI(modelOpts);
      return;
    }

    throw new Error('Unknown call options');
  }

  async convertToModelMessages(
    messages: AgentUIMessage[],
  ): Promise<AgentMessage[]> {
    return await AIconvertToModelMessages(messages);
  }

  async validateUIMessages(messages: unknown): Promise<AgentUIMessage[]> {
    return AIvalidateUIMessages({ messages });
  }

  async getModel(id: ModelRef): Promise<LLMModel | undefined> {
    return this.modelRegistry.getModel(id);
  }

  async getInferenceModel(id: InferenceModelRef): Promise<LLMModel> {
    const model = await this.modelRegistry.getModel(id);
    if (!model) {
      throw new Error(
        `Model ${id} not found. Please configure an AI provider.`,
      );
    }
    return model;
  }

  async getAgenticModel(id: AgenticModelRef): Promise<LLMModel> {
    const model = await this.modelRegistry.getModel(id);
    if (!model) {
      throw new Error(
        `Model ${id} not found. Please configure an AI provider.`,
      );
    }
    return model;
  }

  getAgents(): Map<AgentRef, AgentConfig> {
    return this.agentRegistry.getAgents();
  }

  getAgent(ref: AgentRef): AgentConfig | undefined {
    return this.agentRegistry.getAgent(ref);
  }

  getExposedAgents(): Map<string, AgentRef> {
    return this.agentRegistry.getExposedAgents();
  }

  getAgentRegistry(): AgentRegistry {
    return this.agentRegistry;
  }

  async generateObject<T>(
    options: GenerateObjectOptions<T>,
  ): Promise<GenerateObjectResult<T>> {
    const result = await generateObject({
      model: options.model,
      schema: options.schema as z.ZodType<T>,
      prompt: options.prompt,
    });

    return {
      object: result.object as T,
      usage: result.usage
        ? {
            inputTokens: result.usage.inputTokens ?? 0,
            outputTokens: result.usage.outputTokens ?? 0,
            totalTokens: result.usage.totalTokens ?? 0,
          }
        : undefined,
    };
  }

  async streamObject<T>(options: StreamObjectOptions<T>): Promise<void> {
    const result = streamObject({
      model: options.model,
      schema: options.schema as z.ZodType<T>,
      prompt: options.prompt,
    });

    options.response.setHeader('Content-Type', 'text/event-stream');
    options.response.setHeader('Cache-Control', 'no-cache');
    options.response.setHeader('Connection', 'keep-alive');

    try {
      for await (const chunk of result.textStream) {
        options.response.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
      }
      options.response.write('data: [DONE]\n\n');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Stream error';
      options.response.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    } finally {
      options.response.end();
    }
  }

  private async setupAgentForStreaming(agentOpts: AgentCallOptions) {
    const agentConfig = this.agentRegistry.getAgent(agentOpts.agentRef);

    if (!agentConfig) {
      throw new Error(`Agent ${agentOpts.agentRef.id} not registered`);
    }

    let tools: Record<string, Tool> = agentOpts.tools ?? {};
    const toolsetBuilders: ToolsetBuilder[] = [];
    const attachedToolsets = this.agentRegistry.getAttachedToolsets(
      agentOpts.agentRef,
    );

    for (const ref of attachedToolsets) {
      const builder = this.toolsetRegistry.getToolsetBuilder(ref);
      if (!builder) {
        throw new Error(`Toolset ${ref.id} not registered`);
      }
      await builder.connect?.(agentOpts);
      toolsetBuilders.push(builder);
      const newTools = await builder.getToolset();
      tools = { ...tools, ...newTools };
    }

    const model = await this.modelRegistry.getModel(agentConfig.model);
    if (!model) {
      throw new Error(`Model ${agentConfig.model} not found`);
    }

    const messages = Array.isArray(agentOpts.query)
      ? (agentOpts.query as AgentMessage[])
      : [{ role: 'user' as const, content: agentOpts.query as string }];

    const { trace, generation } = this.agentService.getTracer?.({
      agent: {} as AIAgent,
      model,
      agentId: agentConfig.id,
      userId: agentOpts.userId,
      messages: this.withSystemInstructions({
        messages,
        system: agentOpts.system || agentConfig.system,
      }),
      type: 'agent',
    }) || { trace: undefined, generation: undefined };

    const cumulativeUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };

    const cleanup = async () => {
      await Promise.all(toolsetBuilders.map(toolset => toolset.disconnect?.()));

      if (generation) {
        generation.end({
          usage: {
            promptTokens: cumulativeUsage.inputTokens,
            completionTokens: cumulativeUsage.outputTokens,
            totalTokens: cumulativeUsage.totalTokens,
          },
        });
      }
    };

    const maxSteps = agentConfig.maxSteps || 4;

    const agent = new Agent({
      model,
      instructions: agentOpts.system || agentConfig.system,
      tools,
      toolChoice: agentConfig.toolChoice,
      stopWhen: stepCountIs(maxSteps),
      experimental_context: agentOpts.runtimeContext,
      providerOptions: this.getProviderOptions(),
      prepareStep: ({ stepNumber }) =>
        this.prepareAgentStep(
          stepNumber,
          maxSteps,
          agentOpts.system || agentConfig.system,
          agentConfig.allowToolsOnLastStep,
          tools,
        ),
      onStepFinish: ({
        text,
        toolCalls,
        toolResults,
        finishReason,
        usage,
        reasoning,
      }) => {
        if (usage) {
          cumulativeUsage.inputTokens += usage.inputTokens || 0;
          cumulativeUsage.outputTokens += usage.outputTokens || 0;
          cumulativeUsage.totalTokens += usage.totalTokens || 0;
        }

        this.handleStepTrace({
          text,
          toolCalls,
          toolResults,
          usage,
          finishReason,
          reasoning,
          trace,
        });

        if (finishReason === 'stop' || finishReason === 'error') {
          cleanup().catch(err => {
            this.logger.error('Error during agent cleanup:', err);
          });
        }
      },
    });

    return agent;
  }

  private prepareAgentStep(
    stepNumber: number,
    maxSteps: number,
    systemPrompt?: string,
    allowToolsOnLastStep?: boolean,
    tools?: Record<string, Tool>,
  ) {
    // On the last step, modify system prompt to generate a natural response about step limit
    const isLastStep = stepNumber + 1 === maxSteps;

    if (isLastStep && !allowToolsOnLastStep) {
      return {
        system: `${systemPrompt}

IMPORTANT: This is your final reasoning step (${maxSteps}/${maxSteps}). You have reached the maximum number of steps allowed. Instead of continuing, you must now provide a direct response to the user explaining that:

1. You've reached the reasoning step limit for this query
2. The query appears to be too broad or complex for the current step limit
3. Ask them to rephrase their request to be more specific to Roadie functionality
4. Suggest they break down their question into smaller, more targeted parts

Do NOT call any tools in this step. Generate a helpful, natural response directly.`,
        toolChoice: 'none' as const,
      };
    }

    if (isLastStep && allowToolsOnLastStep && tools) {
      return {
        activeTools: Object.keys(tools),
      };
    }

    return {};
  }

  private withSystemInstructions({
    messages,
    system,
  }: {
    messages: AgentMessage[];
    system?: string;
  }): AgentMessage[] {
    return system
      ? [{ role: 'system' as const, content: system }, ...messages]
      : messages;
  }

  private handleStepTrace({
    text,
    toolCalls,
    toolResults,
    usage,
    finishReason,
    reasoning,
    trace,
  }: {
    text: string;
    toolCalls: AgentToolCall[];
    toolResults: AgentToolResult[];
    usage: AgentStepUsage;
    finishReason?: string;
    reasoning?: ReasoningPart[];
    trace?: TracingHandleStepsOptions['trace'];
  }) {
    if (!trace) {
      return;
    }

    trace.span({
      name: 'agent-step',
      input: { finishReason, usage, reasoning },
      output: text,
    });

    if (toolCalls && toolCalls.length > 0) {
      toolCalls.forEach((toolCall, index) => {
        trace.span({
          name: `tool-call__${toolCall.toolName}`,
          input: toolCall.input,
          output: toolResults?.[index]?.output,
        });
      });
    }

    trace.update({
      output: text,
      usage: {
        inputTokens: usage?.inputTokens || 0,
        outputTokens: usage?.outputTokens || 0,
        totalTokens: usage?.totalTokens || 0,
      },
      finishReason,
      metadata: reasoning ? { reasoning } : undefined,
    });
  }
}
