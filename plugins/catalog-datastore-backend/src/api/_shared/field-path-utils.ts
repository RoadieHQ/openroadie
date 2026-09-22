export function pathSegments(field: string): string[] {
  return field
    .replace(/^\$\./, '')
    .split(/[^a-zA-Z0-9_]+/)
    .map(segment => segment.toLowerCase())
    .filter(Boolean);
}
