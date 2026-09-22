import { describe, expect, it, vi } from 'vitest';
import { subscribeToEntityChanges } from './entity-change-stream';

describe('subscribeToEntityChanges', () => {
  it('reads authenticated fetch-based SSE events', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: entity-change\ndata: {"entity":"actions","operation":"updated"}\n\n',
          ),
        );
        controller.close();
      },
    });
    const fetch = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    const onChange = vi.fn();

    const close = subscribeToEntityChanges({
      url: 'http://localhost/api/entity-change-stream/stream',
      fetch,
      onChange,
      maxReconnectDelayMs: 60_000,
    });

    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({
        entity: 'actions',
        operation: 'updated',
      });
    });

    close();
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost/api/entity-change-stream/stream',
      expect.objectContaining({
        headers: { Accept: 'text/event-stream' },
      }),
    );
  });

  it('reconciles data after reconnecting', async () => {
    const closedStream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
    const openStream = new ReadableStream();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(closedStream, { status: 200 }))
      .mockResolvedValueOnce(new Response(openStream, { status: 200 }));
    const onReconnect = vi.fn();

    const close = subscribeToEntityChanges({
      url: 'http://localhost/api/entity-change-stream/stream',
      fetch,
      onChange: vi.fn(),
      onReconnect,
      maxReconnectDelayMs: 1,
    });

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(onReconnect).toHaveBeenCalledTimes(1);
    });

    close();
  });

  it('reconciles after the initial connection attempts fail', async () => {
    const openStream = new ReadableStream();
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('Stream unavailable'))
      .mockResolvedValueOnce(new Response(openStream, { status: 200 }));
    const onReconnect = vi.fn();

    const close = subscribeToEntityChanges({
      url: 'http://localhost/api/entity-change-stream/stream',
      fetch,
      onChange: vi.fn(),
      onReconnect,
      maxReconnectDelayMs: 1,
    });

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(onReconnect).toHaveBeenCalledTimes(1);
    });

    close();
  });
});
