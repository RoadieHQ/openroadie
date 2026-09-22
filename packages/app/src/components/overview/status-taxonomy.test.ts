import { describe, it, expect } from 'vitest';
import { toExecutionOutcome, EXECUTION, statusValue } from './status-taxonomy';

describe('toExecutionOutcome', () => {
  it('returns "never" when the source has never run', () => {
    expect(
      toExecutionOutcome({ status: undefined, lastRunAt: undefined }),
    ).toBe('never');
  });

  it('returns "succeeded" for a completed run', () => {
    expect(
      toExecutionOutcome({
        status: 'completed',
        objectCount: 5,
        lastRunAt: '2026-01-01T00:00:00Z',
      }),
    ).toBe('succeeded');
  });

  it('returns "failed" for a failed run with no objects', () => {
    expect(
      toExecutionOutcome({
        status: 'failed',
        objectCount: 0,
        lastRunAt: '2026-01-01T00:00:00Z',
      }),
    ).toBe('failed');
  });

  it('returns "partial" for a failed run that still produced objects', () => {
    expect(
      toExecutionOutcome({
        status: 'failed',
        objectCount: 3,
        lastRunAt: '2026-01-01T00:00:00Z',
      }),
    ).toBe('partial');
  });

  it('returns "running" for an in-flight run even though lastRunAt is set', () => {
    expect(
      toExecutionOutcome({
        status: 'running',
        lastRunAt: '2026-01-01T00:00:00Z',
      }),
    ).toBe('running');
  });

  it('returns "running" for a pending run', () => {
    expect(
      toExecutionOutcome({
        status: 'pending',
        lastRunAt: '2026-01-01T00:00:00Z',
      }),
    ).toBe('running');
  });

  it('classifies a running run before considering its (stale) objectCount', () => {
    // A retriggered run keeps the previous run's objectCount while executing;
    // it must not be read as succeeded/partial mid-flight.
    expect(
      toExecutionOutcome({
        status: 'running',
        objectCount: 42,
        lastRunAt: '2026-01-01T00:00:00Z',
      }),
    ).toBe('running');
  });

  it('maps the running outcome to a muted (grey) tone in the EXECUTION map', () => {
    expect(statusValue(EXECUTION, 'running').tone).toBe('muted');
  });
});
