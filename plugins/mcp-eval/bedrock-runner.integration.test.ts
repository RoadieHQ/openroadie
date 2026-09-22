import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bedrockModel: vi.fn(() => ({ id: 'model' })),
  close: vi.fn(),
  generateText: vi.fn(),
  listTools: vi.fn(),
  toolsFromDefinitions: vi.fn(),
}));

vi.mock('@ai-sdk/amazon-bedrock', () => ({
  createAmazonBedrock: vi.fn(() => mocks.bedrockModel),
}));

vi.mock('@ai-sdk/mcp', () => ({
  createMCPClient: vi.fn(async () => ({
    close: mocks.close,
    listTools: mocks.listTools,
    toolsFromDefinitions: mocks.toolsFromDefinitions,
  })),
}));

vi.mock('ai', () => ({
  generateText: mocks.generateText,
  stepCountIs: vi.fn(value => ({ value })),
}));

import { BedrockRunner } from './bedrock-runner';

describe('BedrockRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listTools.mockResolvedValue({
      tools: [
        { name: 'explore_objects_search' },
        { name: 'manage_objects_delete' },
      ],
    });
    mocks.toolsFromDefinitions.mockReturnValue({
      explore_objects_search: { execute: vi.fn() },
    });
    mocks.generateText.mockResolvedValue({
      steps: [
        {
          reasoningText: 'Search by name',
          text: '',
          toolCalls: [
            {
              toolName: 'explore_objects_search',
              input: { query: 'Brian Fletcher' },
            },
          ],
        },
        {
          reasoningText: undefined,
          text: 'Brian Fletcher',
          toolCalls: [],
        },
      ],
      response: { messages: [{ role: 'assistant', content: [] }] },
      totalUsage: { inputTokens: 1_000, outputTokens: 500, totalTokens: 1_500 },
      text: 'Brian Fletcher',
      finishReason: 'stop',
    });
  });

  it('offers only read-only MCP tools and returns the model tool path', async () => {
    const runner = await BedrockRunner.create({
      mcpUrl: 'https://app-api.roadie.so/api/mcp/v1',
      roadieToken: 'token',
      modelId: 'qwen.qwen3-235b-a22b-2507-v1:0',
      readOnly: name => name.startsWith('explore_'),
    });

    const result = await runner.run('Find Brian Fletcher');

    expect(mocks.bedrockModel).toHaveBeenCalledWith(
      'qwen.qwen3-235b-a22b-2507-v1:0',
    );
    expect(mocks.toolsFromDefinitions).toHaveBeenCalledWith({
      tools: [{ name: 'explore_objects_search' }],
    });
    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'Find Brian Fletcher' }],
        tools: mocks.toolsFromDefinitions.mock.results[0].value,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        tools: ['explore_objects_search'],
        answer: 'Brian Fletcher',
        tokens: 1_500,
        costUsd: 0.001025,
        completed: true,
      }),
    );
    await runner.close();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it('does not mark a run as complete when it stops at the step cap', async () => {
    mocks.generateText.mockResolvedValueOnce({
      ...mocks.generateText.mock.results[0]?.value,
      steps: [],
      response: { messages: [] },
      totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      text: '',
      finishReason: 'tool-calls',
    });
    const runner = await BedrockRunner.create({
      mcpUrl: 'https://app-api.roadie.so/api/mcp/v1',
      roadieToken: 'token',
      modelId: 'qwen.qwen3-235b-a22b-2507-v1:0',
      readOnly: () => true,
    });

    await expect(runner.run('Keep searching')).resolves.toMatchObject({
      completed: false,
    });
  });
});
