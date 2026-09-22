import { ResponseError } from '../../api/infrastructure';

/**
 * A manual run request returns 409 when a run is already in progress for the
 * data source (only one runs at a time). This isn't a failure — the data source
 * is already refreshing — so callers surface it as an informational message
 * rather than an error toast.
 */
export function isRunAlreadyInProgress(error: unknown): boolean {
  return error instanceof ResponseError && error.statusCode === 409;
}

export const RUN_ALREADY_IN_PROGRESS_MESSAGE =
  'A run is already in progress for this data source';
