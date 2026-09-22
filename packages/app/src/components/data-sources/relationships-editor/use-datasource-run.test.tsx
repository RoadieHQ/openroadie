// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ApiContext, type ApiClients } from '../../../api/context';
import type { ExecutionEvent } from '../../../api/workflow/workflow-client';
import { ResponseError } from '../../../api/infrastructure/errors';
import { RUN_ALREADY_IN_PROGRESS_MESSAGE } from '../run-conflict';
import { useDataSourceRun } from './use-datasource-run';

type EventHandler = (event: ExecutionEvent) => void;
type ErrorHandler = (error: unknown) => void;

interface StreamHarness {
  emit: EventHandler;
  fail: ErrorHandler;
  cleanup: ReturnType<typeof vi.fn>;
}

function setup(
  options: {
    execute?: ReturnType<typeof vi.fn>;
    getLatestSchema?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const streams: StreamHarness[] = [];
  const post = vi.fn();
  const apis = {
    workflows: {
      executions: {
        execute:
          options.execute ??
          vi.fn().mockResolvedValue({ executionId: 'exec-1' }),
      },
      streaming: {
        streamExecution: vi.fn(
          (_id: string, onEvent: EventHandler, onError: ErrorHandler) => {
            const cleanup = vi.fn();
            streams.push({ emit: onEvent, fail: onError, cleanup });
            return cleanup;
          },
        ),
      },
    },
    datastore: {
      getLatestSchema:
        options.getLatestSchema ?? vi.fn().mockResolvedValue(undefined),
    },
    alert: { post },
  } as unknown as ApiClients;

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ApiContext.Provider value={apis}>{children}</ApiContext.Provider>
  );

  return {
    ...renderHook(() => useDataSourceRun(), { wrapper }),
    streams,
    post,
  };
}

const completed = { type: 'execution-completed' } as ExecutionEvent;

describe('useDataSourceRun', () => {
  it('marks the data source running for the duration of the run', async () => {
    const { result, streams } = setup();

    let run: Promise<void>;
    act(() => {
      run = result.current.run('ds-1');
    });

    await waitFor(() => expect(streams).toHaveLength(1));
    expect(result.current.runningIds.has('ds-1')).toBe(true);

    await act(async () => {
      streams[0].emit(completed);
      await run;
    });

    expect(result.current.runningIds.has('ds-1')).toBe(false);
  });

  it('exposes the schema the run produced', async () => {
    const schema = { datasourceId: 'ds-1', schema: { type: 'object' } };
    const { result, streams } = setup({
      getLatestSchema: vi.fn().mockResolvedValue(schema),
    });

    let run: Promise<void>;
    act(() => {
      run = result.current.run('ds-1');
    });
    await waitFor(() => expect(streams).toHaveLength(1));
    await act(async () => {
      streams[0].emit(completed);
      await run;
    });

    expect(result.current.localSchemas.get('ds-1')).toEqual(schema);
  });

  it('closes the stream when the run completes', async () => {
    const { result, streams } = setup();

    let run: Promise<void>;
    act(() => {
      run = result.current.run('ds-1');
    });
    await waitFor(() => expect(streams).toHaveLength(1));
    await act(async () => {
      streams[0].emit(completed);
      await run;
    });

    expect(streams[0].cleanup).toHaveBeenCalled();
  });

  it.each([
    ['execution-error', 'Run failed: Execution failed'],
    ['execution-cancelled', 'Run failed: Execution cancelled'],
  ])('reports a %s and stops running', async (type, message) => {
    const { result, streams, post } = setup();

    let run: Promise<void>;
    act(() => {
      run = result.current.run('ds-1');
    });
    await waitFor(() => expect(streams).toHaveLength(1));
    await act(async () => {
      streams[0].emit({ type } as ExecutionEvent);
      await run;
    });

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ message, severity: 'error' }),
    );
    expect(result.current.runningIds.has('ds-1')).toBe(false);
  });

  it('reports a stream transport failure', async () => {
    const { result, streams, post } = setup();

    let run: Promise<void>;
    act(() => {
      run = result.current.run('ds-1');
    });
    await waitFor(() => expect(streams).toHaveLength(1));
    await act(async () => {
      streams[0].fail(new Error('socket died'));
      await run;
    });

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error' }),
    );
    expect(result.current.runningIds.has('ds-1')).toBe(false);
  });

  // A concurrent run started elsewhere is expected, not an error worth a red
  // toast. `isRunAlreadyInProgress` recognises it only as a ResponseError with
  // status 409, so the rejection has to be a real one — anything else takes the
  // generic failure branch and this would assert nothing about the info path.
  it('reports an already-running execution as information, not an error', async () => {
    const { result, post } = setup({
      execute: vi
        .fn()
        .mockRejectedValue(new ResponseError('already in progress', 409)),
    });

    await act(async () => {
      await result.current.run('ds-1');
    });

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        message: RUN_ALREADY_IN_PROGRESS_MESSAGE,
        severity: 'info',
        display: 'transient',
      }),
    );
    expect(post).not.toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error' }),
    );
    expect(result.current.runningIds.has('ds-1')).toBe(false);
  });

  it('reports any other execute failure as an error', async () => {
    const { result, post } = setup({
      execute: vi.fn().mockRejectedValue(new Error('boom')),
    });

    await act(async () => {
      await result.current.run('ds-1');
    });

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error' }),
    );
  });

  it('ignores events arriving after the run already settled', async () => {
    const { result, streams } = setup();

    let run: Promise<void>;
    act(() => {
      run = result.current.run('ds-1');
    });
    await waitFor(() => expect(streams).toHaveLength(1));
    await act(async () => {
      streams[0].emit(completed);
      await run;
    });

    // A late error must not resurrect the run or double-report.
    await act(async () => {
      streams[0].fail(new Error('late'));
    });

    expect(result.current.runningIds.has('ds-1')).toBe(false);
  });

  it('tracks concurrent runs independently', async () => {
    const { result, streams } = setup();

    let first: Promise<void>;
    let second: Promise<void>;
    act(() => {
      first = result.current.run('ds-1');
      second = result.current.run('ds-2');
    });
    await waitFor(() => expect(streams).toHaveLength(2));

    expect(result.current.runningIds.has('ds-1')).toBe(true);
    expect(result.current.runningIds.has('ds-2')).toBe(true);

    await act(async () => {
      streams[0].emit(completed);
      await first;
    });

    expect(result.current.runningIds.has('ds-1')).toBe(false);
    expect(result.current.runningIds.has('ds-2')).toBe(true);

    await act(async () => {
      streams[1].emit(completed);
      await second;
    });
  });

  // The stream is a live SSE connection, so an unmount mid-run has to close it
  // or the socket outlives the component.
  it('closes any open stream on unmount', async () => {
    const { result, streams, unmount } = setup();

    act(() => {
      void result.current.run('ds-1');
    });
    await waitFor(() => expect(streams).toHaveLength(1));

    unmount();

    expect(streams[0].cleanup).toHaveBeenCalled();
  });
});
