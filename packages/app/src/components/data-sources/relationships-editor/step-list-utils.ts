/**
 * Pure helpers shared across the stepped relationship editor (the step map,
 * the pipeline columns, and the preview-data hook). Kept separate from the
 * view so they can be unit-tested in isolation.
 */

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export function asHttpMethod(method?: string): HttpMethod {
  return HTTP_METHODS.includes(method as HttpMethod)
    ? (method as HttpMethod)
    : 'GET';
}

export function isAdvancedIntegrationRequestPath(
  config: { pathExpression?: string } | null | undefined,
): boolean {
  return Boolean(config?.pathExpression?.trim());
}

/** Walk a key path to a primitive value (undefined for missing/containers).
 * An array of primitives resolves to its first element: an array field is a
 * valid match target, and the rule engine flattens it and compares elementwise
 * (see the backend's `normalizeFieldValues`, whose representative value is
 * likewise the first). Reading one as "no value" would make a populated field
 * look empty. */
export function valueAtPath(obj: unknown, path: string[]): string | undefined {
  let cur: unknown = obj;
  for (const seg of path) {
    if (typeof cur !== 'object' || cur === null) {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[`${seg}`];
  }
  if (Array.isArray(cur)) {
    cur = cur.find(v => v != null && typeof v !== 'object');
  }
  if (cur == null || typeof cur === 'object') {
    return undefined;
  }
  return String(cur);
}

/** Resolve the lookup request path for display/fetch by substituting the source
 * value into a `{value}` template. */
export function resolveLookupPath(
  pathTemplate: string | undefined,
  sourceValue: string | undefined,
): string {
  return (pathTemplate ?? '').replace(
    /\{value\}/g,
    encodeURIComponent(sourceValue ?? ''),
  );
}
