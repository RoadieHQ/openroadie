import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { generateText, stepCountIs, type ModelMessage, type ToolSet } from 'ai';
import type { Step } from './eval';

export interface BedrockModelConfig {
  region: string;
  invocationModelId?: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
}

export const BEDROCK_MODELS = new Map<string, BedrockModelConfig>([
  [
    'qwen.qwen3-235b-a22b-2507-v1:0',
    {
      region: 'eu-west-2',
      inputPricePerMillion: 0.34,
      outputPricePerMillion: 1.37,
    },
  ],
  [
    'moonshotai.kimi-k2.5',
    {
      region: 'us-east-1',
      inputPricePerMillion: 0.6,
      outputPricePerMillion: 3,
    },
  ],
]);

export interface BedrockRunResult {
  tools: string[];
  calls: Array<{ name: string; input: unknown }>;
  steps: Step[];
  answer: string;
  tokens: number;
  costUsd: number;
  completed: boolean;
}

export function calculateBedrockCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = BEDROCK_MODELS.get(model);
  if (!pricing) {
    throw new Error(`No Bedrock pricing configured for ${model}.`);
  }
  return (
    (inputTokens * pricing.inputPricePerMillion +
      outputTokens * pricing.outputPricePerMillion) /
    1_000_000
  );
}

export class BedrockRunner {
  readonly client: MCPClient;
  readonly tools: ToolSet;
  readonly model: ReturnType<ReturnType<typeof createAmazonBedrock>>;
  readonly modelId: string;
  messages: ModelMessage[] = [];

  private constructor(
    client: MCPClient,
    tools: ToolSet,
    modelId: string,
    region: string,
    invocationModelId?: string,
  ) {
    this.client = client;
    this.tools = tools;
    this.modelId = modelId;
    this.model = createAmazonBedrock({ region })(invocationModelId ?? modelId);
  }

  static async create(options: {
    mcpUrl: string;
    roadieToken: string;
    modelId: string;
    readOnly: (name: string) => boolean;
  }): Promise<BedrockRunner> {
    const pricing = BEDROCK_MODELS.get(options.modelId);
    if (!pricing) {
      throw new Error(`Unsupported Bedrock eval model: ${options.modelId}.`);
    }
    const client = await createMCPClient({
      clientName: 'roadie-mcp-eval',
      transport: {
        type: 'http',
        url: options.mcpUrl,
        headers: { Authorization: `Bearer ${options.roadieToken}` },
      },
    });
    const definitions = await client.listTools();
    const tools = client.toolsFromDefinitions({
      ...definitions,
      tools: definitions.tools.filter(tool => options.readOnly(tool.name)),
    });
    return new BedrockRunner(
      client,
      tools,
      options.modelId,
      pricing.region,
      pricing.invocationModelId,
    );
  }

  async run(prompt: string): Promise<BedrockRunResult> {
    const result = await generateText({
      model: this.model,
      tools: this.tools,
      messages: [...this.messages, { role: 'user', content: prompt }],
      stopWhen: stepCountIs(12),
    });
    this.messages.push(
      { role: 'user', content: prompt },
      ...result.response.messages,
    );
    const calls = result.steps.flatMap(step =>
      step.toolCalls.map(call => ({
        name: call.toolName,
        input: call.input,
      })),
    );
    const steps = result.steps.flatMap<Step>(step => {
      const items: Step[] = [];
      if (step.reasoningText) {
        items.push({ type: 'thinking', text: step.reasoningText });
      }
      items.push(
        ...step.toolCalls.map(call => ({
          type: 'tool' as const,
          name: call.toolName,
          input: call.input,
        })),
      );
      if (step.text) {
        items.push({ type: 'text', text: step.text });
      }
      return items;
    });
    const inputTokens = result.totalUsage.inputTokens ?? 0;
    const outputTokens = result.totalUsage.outputTokens ?? 0;
    return {
      tools: calls.map(call => call.name),
      calls,
      steps,
      answer: result.text,
      tokens: result.totalUsage.totalTokens ?? inputTokens + outputTokens,
      costUsd: calculateBedrockCost(this.modelId, inputTokens, outputTokens),
      completed: result.finishReason === 'stop',
    };
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
