import { describe, it, expect } from 'vitest';
import {
  shouldPollExecutions,
  RUNNING_POLL_MAX_AGE_MS,
  type PollableExecution,
} from './execution-polling';

const NOW = Date.parse('2026-08-21T12:00:00Z');

const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('shouldPollExecutions', () => {
  it('does not poll when there is no execution state yet', () => {
    expect(shouldPollExecutions(undefined, NOW)).toBe(false);
    expect(shouldPollExecutions([], NOW)).toBe(false);
  });

  it('does not poll when every run has settled', () => {
    const executions: PollableExecution[] = [
      { status: 'completed', lastRunAt: ago(1_000) },
      { status: 'failed', lastRunAt: ago(1_000) },
      { status: 'cancelled', lastRunAt: ago(1_000) },
    ];
    expect(shouldPollExecutions(executions, NOW)).toBe(false);
  });

  it('polls while a run is running and recently started', () => {
    expect(
      shouldPollExecutions(
        [
          { status: 'completed', lastRunAt: ago(1_000) },
          { status: 'running', lastRunAt: ago(5_000) },
        ],
        NOW,
      ),
    ).toBe(true);
  });

  it('polls an active run that has no recorded run time yet', () => {
    expect(
      shouldPollExecutions([{ status: 'pending', lastRunAt: undefined }], NOW),
    ).toBe(true);
  });

  it('stops polling a run running longer than the max age (orphaned/hung)', () => {
    expect(
      shouldPollExecutions(
        [
          {
            status: 'running',
            lastRunAt: ago(RUNNING_POLL_MAX_AGE_MS + 1_000),
          },
        ],
        NOW,
      ),
    ).toBe(false);
  });

  it('keeps polling if at least one active run is still within the age window', () => {
    expect(
      shouldPollExecutions(
        [
          {
            status: 'running',
            lastRunAt: ago(RUNNING_POLL_MAX_AGE_MS + 1_000),
          },
          { status: 'running', lastRunAt: ago(2_000) },
        ],
        NOW,
      ),
    ).toBe(true);
  });

  it('accepts a Map values() iterator (the merged executionData shape)', () => {
    const map = new Map<string, PollableExecution>([
      ['a', { status: 'completed', lastRunAt: ago(1_000) }],
      ['b', { status: 'running', lastRunAt: ago(2_000) }],
    ]);
    expect(shouldPollExecutions(map.values(), NOW)).toBe(true);
  });
});
