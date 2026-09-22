import { Knex } from 'knex';
import { DatabaseEventSink } from './database-event-sink';
import { McpToolCallEvent } from '../types';

const mockInsert = vi.fn().mockResolvedValue(undefined);
const mockDel = vi.fn().mockResolvedValue(0);
const mockWhere = vi.fn().mockReturnValue({ del: mockDel });
const mockKnex = vi.fn().mockReturnValue({
  insert: mockInsert,
  where: mockWhere,
}) as unknown as Knex;

const baseEvent: McpToolCallEvent = {
  correlationId: 'corr-1',
  service: 'explore',
  tool: 'search',
  durationMs: 100,
  status: 'success',
  customerId: 'user:default/jane',
  workspaceId: 'workspace-a',
  timestamp: '2026-01-01T00:00:00.000Z',
  toolInput: { query: 'pods' },
};

describe('DatabaseEventSink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should insert a row into mcp_tool_call_log', async () => {
    const sink = new DatabaseEventSink(mockKnex, 30);
    await sink.emit(baseEvent);

    expect(mockKnex).toHaveBeenCalledWith('mcp_tool_call_log');
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        correlation_id: 'corr-1',
        service: 'explore',
        tool: 'search',
        status: 'success',
        duration_ms: 100,
        customer_id: 'user:default/jane',
        workspace_id: 'workspace-a',
        tool_input: JSON.stringify({ query: 'pods' }),
        error_message: null,
        created_at: '2026-01-01T00:00:00.000Z',
        tool_output: null,
        input_tokens: null,
        output_tokens: null,
      }),
    );
  });

  it('should handle null tool_input when not provided', async () => {
    const eventWithoutInput: McpToolCallEvent = {
      ...baseEvent,
      toolInput: undefined,
    };
    const sink = new DatabaseEventSink(mockKnex, 30);
    await sink.emit(eventWithoutInput);

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ tool_input: null }),
    );
  });

  it('should store tool output and token counts', async () => {
    const eventWithOutput: McpToolCallEvent = {
      ...baseEvent,
      toolOutput: [{ type: 'text', text: 'result' }],
      inputTokens: 12,
      outputTokens: 34,
    };
    const sink = new DatabaseEventSink(mockKnex, 30);
    await sink.emit(eventWithOutput);

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_output: JSON.stringify([{ type: 'text', text: 'result' }]),
        input_tokens: 12,
        output_tokens: 34,
      }),
    );
  });

  it('should store error_message on error events', async () => {
    const errorEvent: McpToolCallEvent = {
      ...baseEvent,
      status: 'error',
      errorMessage: 'timeout',
    };
    const sink = new DatabaseEventSink(mockKnex, 30);
    await sink.emit(errorEvent);

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        error_message: 'timeout',
      }),
    );
  });

  it('rejects events without a workspace', async () => {
    const sink = new DatabaseEventSink(mockKnex, 30);

    await expect(
      sink.emit({ ...baseEvent, workspaceId: undefined }),
    ).rejects.toThrow('MCP event workspace is required');
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
