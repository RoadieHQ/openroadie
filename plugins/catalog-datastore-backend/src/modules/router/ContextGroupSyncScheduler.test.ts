import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoggerService } from '@roadiehq/extensions-api';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';
import { ContextGroupSyncScheduler } from './ContextGroupSyncScheduler';

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

describe('ContextGroupSyncScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('coalesces repeated schedules for the same datasource', async () => {
    const materializeForDatasource = vi.fn().mockResolvedValue(undefined);
    const scheduler = new ContextGroupSyncScheduler({
      delayMs: 1000,
      logger: makeLogger(),
      materializeForDatasource,
    });

    scheduler.schedule('ds-1');
    scheduler.schedule('ds-1');
    scheduler.schedule('ds-1');

    await vi.advanceTimersByTimeAsync(1000);
    await scheduler.flushNow();

    expect(materializeForDatasource).toHaveBeenCalledTimes(1);
    expect(materializeForDatasource).toHaveBeenCalledWith(
      'ds-1',
      DEFAULT_WORKSPACE_ID,
    );
  });

  it('drops pending materialization after its workspace is deleted', async () => {
    const materializeForDatasource = vi.fn().mockResolvedValue(undefined);
    const scheduler = new ContextGroupSyncScheduler({
      delayMs: 1000,
      logger: makeLogger(),
      materializeForDatasource,
      workspaceExists: vi.fn().mockResolvedValue(false),
    });

    scheduler.schedule('ds-1', 'workspace-deleted');
    await scheduler.flushNow();

    expect(materializeForDatasource).not.toHaveBeenCalled();
  });

  it('processes each datasource once per batch and flushes pending work', async () => {
    const materializeForDatasource = vi.fn().mockResolvedValue(undefined);
    const scheduler = new ContextGroupSyncScheduler({
      delayMs: 1000,
      logger: makeLogger(),
      materializeForDatasource,
    });

    scheduler.schedule('ds-1');
    scheduler.schedule('ds-2');
    scheduler.schedule('ds-1');

    await scheduler.flushNow();

    expect(materializeForDatasource).toHaveBeenCalledTimes(2);
    expect(materializeForDatasource.mock.calls).toEqual([
      ['ds-1', DEFAULT_WORKSPACE_ID],
      ['ds-2', DEFAULT_WORKSPACE_ID],
    ]);
  });

  it('keeps pending work separate across workspaces', async () => {
    const materializeForDatasource = vi.fn().mockResolvedValue(undefined);
    const scheduler = new ContextGroupSyncScheduler({
      delayMs: 1000,
      logger: makeLogger(),
      materializeForDatasource,
      workspaceExists: vi.fn().mockResolvedValue(true),
    });

    scheduler.schedule('ds-1', 'workspace-a');
    scheduler.schedule('ds-1', 'workspace-b');
    await scheduler.flushNow();

    expect(materializeForDatasource.mock.calls).toEqual([
      ['ds-1', 'workspace-a'],
      ['ds-1', 'workspace-b'],
    ]);
  });

  it('logs failures and continues processing the remaining datasources', async () => {
    const logger = makeLogger();
    const materializeForDatasource = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const scheduler = new ContextGroupSyncScheduler({
      delayMs: 1000,
      logger,
      materializeForDatasource,
    });

    scheduler.schedule('ds-1');
    scheduler.schedule('ds-2');

    await scheduler.flushNow();

    expect(materializeForDatasource).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to sync context groups for datasource ds-1: Error: boom',
    );
  });

  describe('syncDatasourceNow', () => {
    it('rebuilds the datasource once, absorbing its pending debounced entry', async () => {
      const materializeForDatasource = vi.fn().mockResolvedValue(undefined);
      const scheduler = new ContextGroupSyncScheduler({
        delayMs: 1000,
        logger: makeLogger(),
        materializeForDatasource,
      });

      scheduler.schedule('ds-1');
      await scheduler.syncDatasourceNow('ds-1');
      // The debounce window elapsing must not rebuild again.
      await vi.advanceTimersByTimeAsync(1000);
      await scheduler.flushNow();

      expect(materializeForDatasource).toHaveBeenCalledTimes(1);
      expect(materializeForDatasource).toHaveBeenCalledWith(
        'ds-1',
        DEFAULT_WORKSPACE_ID,
      );
    });

    it('flushes other pending datasources before the synchronous rebuild', async () => {
      const materializeForDatasource = vi.fn().mockResolvedValue(undefined);
      const scheduler = new ContextGroupSyncScheduler({
        delayMs: 1000,
        logger: makeLogger(),
        materializeForDatasource,
      });

      scheduler.schedule('ds-other');
      await scheduler.syncDatasourceNow('ds-1');

      expect(materializeForDatasource.mock.calls).toEqual([
        ['ds-other', DEFAULT_WORKSPACE_ID],
        ['ds-1', DEFAULT_WORKSPACE_ID],
      ]);
    });

    it('propagates a failure and restores the debounced rebuild', async () => {
      const materializeForDatasource = vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue(undefined);
      const scheduler = new ContextGroupSyncScheduler({
        delayMs: 1000,
        logger: makeLogger(),
        materializeForDatasource,
      });

      await expect(scheduler.syncDatasourceNow('ds-1')).rejects.toThrow('boom');

      await vi.advanceTimersByTimeAsync(1000);
      await scheduler.flushNow();
      expect(materializeForDatasource).toHaveBeenCalledTimes(2);
      expect(materializeForDatasource).toHaveBeenLastCalledWith(
        'ds-1',
        DEFAULT_WORKSPACE_ID,
      );
    });

    // Overlapping rebuilds of a rule spanning both datasources commit two
    // group sets (each transaction's DELETE misses the other's uncommitted
    // inserts), so the scheduler must never run two rebuilds concurrently.
    it('serializes concurrent synchronous rebuilds', async () => {
      const { materializeForDatasource, maxConcurrent, calls } =
        trackedMaterialize(20);
      const scheduler = new ContextGroupSyncScheduler({
        delayMs: 1000,
        logger: makeLogger(),
        materializeForDatasource,
      });

      const both = Promise.all([
        scheduler.syncDatasourceNow('ds-a'),
        scheduler.syncDatasourceNow('ds-b'),
      ]);
      await vi.advanceTimersByTimeAsync(100);
      await both;

      expect(calls).toEqual(['ds-a', 'ds-b']);
      expect(maxConcurrent()).toBe(1);
    });

    it('serializes a debounced flush against an in-flight synchronous rebuild', async () => {
      const { materializeForDatasource, maxConcurrent, calls } =
        trackedMaterialize(50);
      const scheduler = new ContextGroupSyncScheduler({
        delayMs: 10,
        logger: makeLogger(),
        materializeForDatasource,
      });

      const sync = scheduler.syncDatasourceNow('ds-a');
      // Let the rebuild start, then land an edge write whose debounce window
      // elapses while the rebuild is still running.
      await vi.advanceTimersByTimeAsync(0);
      scheduler.schedule('ds-other');
      await vi.advanceTimersByTimeAsync(200);
      await sync;
      await scheduler.flushNow();

      expect(calls).toEqual(['ds-a', 'ds-other']);
      expect(maxConcurrent()).toBe(1);
    });
  });
});

/** A materialize stub that holds each rebuild open for `durationMs` (fake
 *  timers) and records how many rebuilds ever ran at once. */
function trackedMaterialize(durationMs: number) {
  let active = 0;
  let peak = 0;
  const calls: string[] = [];
  const materializeForDatasource = vi.fn(async (datasourceId: string) => {
    calls.push(datasourceId);
    active += 1;
    peak = Math.max(peak, active);
    await new Promise<void>(resolve => setTimeout(resolve, durationMs));
    active -= 1;
  });
  return { materializeForDatasource, calls, maxConcurrent: () => peak };
}
