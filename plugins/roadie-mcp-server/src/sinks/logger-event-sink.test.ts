import { LoggerEventSink } from './logger-event-sink';
import { McpToolCallEvent } from '../types';
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

describe('LoggerEventSink', () => {
  it('should log info for successful tool calls', () => {
    const logger = createMockLogger();
    const sink = new LoggerEventSink(logger);
    const event: McpToolCallEvent = {
      correlationId: 'corr-1',
      service: 'explore',
      tool: 'search',
      durationMs: 50,
      status: 'success',
      customerId: 'user:default/jane',
      timestamp: '2026-01-01T00:00:00.000Z',
    };

    sink.emit(event);

    expect(logger.info).toHaveBeenCalledWith(
      'MCP tool called',
      expect.objectContaining({
        service: 'explore',
        tool: 'search',
        status: 'success',
        correlationId: 'corr-1',
      }),
    );
  });

  it('should log error for failed tool calls', () => {
    const logger = createMockLogger();
    const sink = new LoggerEventSink(logger);
    const event: McpToolCallEvent = {
      correlationId: 'corr-2',
      service: 'integrations',
      tool: 'integrations_request_http',
      durationMs: 200,
      status: 'error',
      timestamp: '2026-01-01T00:00:00.000Z',
      errorMessage: 'connection refused',
    };

    sink.emit(event);

    expect(logger.error).toHaveBeenCalledWith(
      'MCP tool threw',
      expect.objectContaining({
        status: 'error',
        errorMessage: 'connection refused',
      }),
    );
  });
});
