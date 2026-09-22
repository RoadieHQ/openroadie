import humanizeDuration from 'humanize-duration';

/**
 * Shared relative-time formatter for overview tables' time column. Produces a
 * single, coarse "X ago" string (e.g. `3 days ago`) so every overview renders
 * timestamps identically. Returns `null` for missing/invalid input so callers
 * can render an em dash.
 */
export function formatUpdated(iso?: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  return `${humanizeDuration(ms, { largest: 1, round: true })} ago`;
}
