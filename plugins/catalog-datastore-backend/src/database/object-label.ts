/**
 * The canonical ordered list of object fields that can name an object, most to
 * least preferred. Single source of truth for both the SQL label extraction in
 * `ObjectDao` (a `COALESCE` over these JSON paths) and the JS-side derivation in
 * `deriveObjectLabel` below (used when the object is already in memory, e.g.
 * context-group members). Keep the two in sync by importing from here.
 */
export const DISPLAY_NAME_PATHS: readonly string[][] = [
  ['name'],
  ['title'],
  ['displayName'],
  ['display_name'],
  ['full_name'],
  ['fullName'],
  ['profile', 'name'],
  ['profile', 'displayName'],
  ['email'],
  ['profile', 'email'],
  ['login'],
  ['username'],
  ['label'],
  ['summary'],
  ['description'],
  ['metadata', 'name'],
  ['slug'],
];

/**
 * Walk `DISPLAY_NAME_PATHS` over an already-parsed object and return the first
 * non-empty string label, or `undefined` when the object has none. Callers that
 * need a guaranteed string fall back to the object id themselves.
 */
export function deriveObjectLabel(object: unknown): string | undefined {
  if (typeof object !== 'object' || object === null || Array.isArray(object)) {
    return undefined;
  }

  for (const path of DISPLAY_NAME_PATHS) {
    let current: unknown = object;
    for (const key of path) {
      if (
        typeof current !== 'object' ||
        current === null ||
        Array.isArray(current)
      ) {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[`${key}`];
    }
    if (typeof current === 'string' && current.trim()) {
      return current.trim();
    }
  }

  return undefined;
}
