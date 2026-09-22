/** Parse a comma-separated query param into a list of ids. */
export function parseCsvParam(value: string | null): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}
