import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LoggerService } from '@roadiehq/extensions-api';
import { AutoApplyCoalescer } from './AutoApplyCoalescer';

function makeLogger(): LoggerService {
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    child: () => logger,
  };
  return logger as unknown as LoggerService;
}

describe('AutoApplyCoalescer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('coalesces multiple schedules within the delay window into one run', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const coalescer = new AutoApplyCoalescer({
      delayMs: 1000,
      logger: makeLogger(),
      run,
    });

    coalescer.schedule('a');
    coalescer.schedule('b');
    coalescer.schedule('a');

    expect(run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    await coalescer.flushNow();

    expect(run).toHaveBeenCalledTimes(1);
    expect(new Set(run.mock.calls[0][0])).toEqual(new Set(['a', 'b']));
    expect(run.mock.calls[0][1]).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('unschedule drops a pending id without disturbing the rest of the batch', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const coalescer = new AutoApplyCoalescer({
      delayMs: 1000,
      logger: makeLogger(),
      run,
    });

    coalescer.schedule('a');
    coalescer.schedule('b');
    coalescer.unschedule('a');

    await vi.advanceTimersByTimeAsync(1000);
    await coalescer.flushNow();

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toEqual(['b']);
    expect(run.mock.calls[0][1]).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('a batch emptied by unschedule never runs', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const coalescer = new AutoApplyCoalescer({
      delayMs: 1000,
      logger: makeLogger(),
      run,
    });

    coalescer.schedule('a');
    coalescer.unschedule('a');

    await vi.advanceTimersByTimeAsync(1000);
    await coalescer.flushNow();

    expect(run).not.toHaveBeenCalled();
  });

  it('starts a new window after a flush', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const coalescer = new AutoApplyCoalescer({
      delayMs: 500,
      logger: makeLogger(),
      run,
    });

    coalescer.schedule('a');
    await vi.advanceTimersByTimeAsync(500);
    await coalescer.flushNow();
    expect(run).toHaveBeenCalledTimes(1);

    coalescer.schedule('b');
    await vi.advanceTimersByTimeAsync(500);
    await coalescer.flushNow();

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0]).toEqual(['b']);
  });

  it('keeps workspace batches separate', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const coalescer = new AutoApplyCoalescer({
      delayMs: 100,
      logger: makeLogger(),
      run,
    });

    coalescer.schedule('shared-datasource', 'workspace-a');
    coalescer.schedule('shared-datasource', 'workspace-b');

    await vi.advanceTimersByTimeAsync(100);
    await coalescer.flushNow();

    expect(run.mock.calls).toEqual([
      [['shared-datasource'], 'workspace-a'],
      [['shared-datasource'], 'workspace-b'],
    ]);
  });

  it('logs but does not throw when the run fails', async () => {
    const run = vi.fn().mockRejectedValue(new Error('boom'));
    const logger = makeLogger();
    const coalescer = new AutoApplyCoalescer({
      delayMs: 100,
      logger,
      run,
    });

    coalescer.schedule('a');
    await vi.advanceTimersByTimeAsync(100);
    await expect(coalescer.flushNow()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('continues with the next workspace after one workspace fails', async () => {
    const run = vi.fn(async (_ids: string[], workspaceId: string) => {
      if (workspaceId === 'workspace-a') {
        throw new Error('workspace A failed');
      }
    });
    const coalescer = new AutoApplyCoalescer({
      delayMs: 100,
      logger: makeLogger(),
      run,
    });

    coalescer.schedule('datasource-a', 'workspace-a');
    coalescer.schedule('datasource-b', 'workspace-b');

    await vi.advanceTimersByTimeAsync(100);
    await coalescer.flushNow();

    expect(run.mock.calls).toEqual([
      [['datasource-a'], 'workspace-a'],
      [['datasource-b'], 'workspace-b'],
    ]);
  });

  describe('runExclusive', () => {
    it('serializes exclusive work against an in-flight batch', async () => {
      const order: string[] = [];
      const run = vi.fn(async (ids: string[]) => {
        order.push(`batch:${ids.join(',')}`);
        await new Promise<void>(resolve => setTimeout(resolve, 50));
        order.push('batch-done');
      });
      const coalescer = new AutoApplyCoalescer({
        delayMs: 10,
        logger: makeLogger(),
        run,
      });

      coalescer.schedule('a');
      await vi.advanceTimersByTimeAsync(10);
      const exclusive = coalescer.runExclusive(async () => {
        order.push('exclusive');
      });
      await vi.advanceTimersByTimeAsync(100);
      await exclusive;

      expect(order).toEqual(['batch:a', 'batch-done', 'exclusive']);
    });

    it('propagates a rejection to the caller and keeps the chain usable', async () => {
      const run = vi.fn().mockResolvedValue(undefined);
      const coalescer = new AutoApplyCoalescer({
        delayMs: 10,
        logger: makeLogger(),
        run,
      });

      await expect(
        coalescer.runExclusive(() => Promise.reject(new Error('boom'))),
      ).rejects.toThrow('boom');

      coalescer.schedule('a');
      await vi.advanceTimersByTimeAsync(10);
      await coalescer.flushNow();
      expect(run).toHaveBeenCalledWith(
        ['a'],
        '00000000-0000-4000-8000-000000000001',
      );
    });
  });
});
