/**
 * How the overview keeps a data source's "Running…" status honest without a
 * realtime channel: React Query polls the (single, batched) execution-summaries
 * request, but only while a run is actually in flight. This module owns the
 * "should we still be polling?" decision so it can be reasoned about and tested
 * in isolation from the hook.
 *
 * The decision is made over the **merged** execution state (server summaries
 * folded together with the optimistic `noteRunStarted` overlay), not the raw
 * query cache — a manual run flips the row to `running` optimistically before
 * the server refetch confirms it (which can lag behind a reader replica), and
 * the poll must start in that window or "Running…" would never resolve.
 *
 * Bounds that keep the polling from becoming a load problem:
 * - it is gated on an active run — no run in flight, no interval (see caller);
 * - React Query's `refetchIntervalInBackground` defaults to false, so a
 *   backgrounded tab stops polling regardless of this decision;
 * - a run that has been `running` longer than {@link RUNNING_POLL_MAX_AGE_MS} is
 *   treated as orphaned/hung and no longer polled — otherwise a status that the
 *   backend never transitions would poll forever. Such a row still refreshes on
 *   the summaries query's normal triggers (window refocus, navigation).
 */

/** The subset of an execution's merged state the poll gate reads. */
export interface PollableExecution {
  status?: string;
  /** Run start proxy — a running run's start time, or the optimistic run time. */
  lastRunAt?: string;
}

/** Poll cadence while a run is active. */
export const RUNNING_POLL_INTERVAL_MS = 5_000;

/**
 * Past this age a still-`running` entry is assumed stuck/orphaned and dropped
 * from the poll gate. Generous enough to cover real long-running ingestions;
 * the backend's own execution stream caps at 5 minutes.
 */
export const RUNNING_POLL_MAX_AGE_MS = 10 * 60_000;

const ACTIVE_STATUSES = new Set(['running', 'pending']);

/**
 * True when at least one execution represents a run we should keep polling for —
 * i.e. it is `pending`/`running` and (if it has a run time) has not been running
 * past {@link RUNNING_POLL_MAX_AGE_MS}. An active run without a recorded time is
 * always polled: it is about to begin.
 */
export function shouldPollExecutions(
  executions: Iterable<PollableExecution> | undefined,
  now: number,
): boolean {
  if (!executions) {
    return false;
  }
  for (const execution of executions) {
    if (!execution.status || !ACTIVE_STATUSES.has(execution.status)) {
      continue;
    }
    if (!execution.lastRunAt) {
      return true;
    }
    const startedAt = new Date(execution.lastRunAt).getTime();
    if (Number.isNaN(startedAt) || now - startedAt <= RUNNING_POLL_MAX_AGE_MS) {
      return true;
    }
  }
  return false;
}
