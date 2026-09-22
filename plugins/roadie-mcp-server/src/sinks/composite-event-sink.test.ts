import { CompositeEventSink } from './composite-event-sink';
import { McpEventSink, McpToolCallEvent } from '../types';
import { LoggerService } from '@roadiehq/extensions-api';

function createMockLogger(): LoggerService {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  } as unknown as LoggerService;
}

const baseEvent: McpToolCallEvent = {
  correlationId: 'corr-1',
  service: 'test-service',
  tool: 'test-tool',
  durationMs: 100,
  status: 'success',
  timestamp: '2026-01-01T00:00:00.000Z',
};

describe('CompositeEventSink', () => {
  it('should fan out to all sinks', async () => {
    const sink1: McpEventSink = { emit: vi.fn() };
    const sink2: McpEventSink = { emit: vi.fn() };
    const logger = createMockLogger();

    const composite = new CompositeEventSink([sink1, sink2], logger);
    await composite.emit(baseEvent);

    expect(sink1.emit).toHaveBeenCalledWith(baseEvent);
    expect(sink2.emit).toHaveBeenCalledWith(baseEvent);
  });

  it('should not throw if one sink fails', async () => {
    const failingSink: McpEventSink = {
      emit: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const goodSink: McpEventSink = { emit: vi.fn() };
    const logger = createMockLogger();

    const composite = new CompositeEventSink([failingSink, goodSink], logger);
    await expect(composite.emit(baseEvent)).resolves.toBeUndefined();

    expect(goodSink.emit).toHaveBeenCalledWith(baseEvent);
    expect(logger.warn).toHaveBeenCalledWith(
      'MCP event sink failed',
      expect.objectContaining({ error: 'boom' }),
    );
  });
});
