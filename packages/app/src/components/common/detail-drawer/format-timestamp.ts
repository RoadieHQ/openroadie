import humanizeDuration from 'humanize-duration';

const absoluteFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** "3 days ago" — the coarse relative time shown as a drawer field value. */
export function formatRelative(iso?: string): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return `${humanizeDuration(ms, { largest: 1, round: true })} ago`;
}

/** Full date/time for the field's `title` tooltip. */
export function formatAbsolute(iso?: string): string | undefined {
  if (!iso) return undefined;
  return absoluteFormatter.format(new Date(iso));
}
