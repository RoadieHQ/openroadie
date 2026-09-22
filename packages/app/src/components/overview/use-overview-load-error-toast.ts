import { useEffect } from 'react';
import { useAlert } from '../../api';

/** Errors already surfaced so remounts do not re-toast cached query failures. */
const surfacedLoadErrors = new WeakSet<Error>();

/**
 * Post a one-time error toast for a failed overview list load. Safe across
 * Strict Mode remounts and returning to a page with a cached query error.
 */
export function useOverviewLoadErrorToast(
  error: Error | null | undefined,
): void {
  const alertApi = useAlert();

  useEffect(() => {
    if (!error || surfacedLoadErrors.has(error)) {
      return;
    }
    surfacedLoadErrors.add(error);
    alertApi.post({ message: error.message, severity: 'error' });
  }, [error, alertApi]);
}
